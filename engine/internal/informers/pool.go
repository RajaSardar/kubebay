package informers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/metadata"
	"k8s.io/client-go/metadata/metadatainformer"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

const (
	evictAfter = 5 * time.Minute
	sweepEvery = time.Minute
)

type poolKey struct {
	gvr       schema.GroupVersionResource
	namespace string
	selector  string
}

type entry struct {
	key         poolKey
	informer    cache.SharedIndexInformer
	fanout      chan stream.Op
	stop        chan struct{}
	mu          sync.RWMutex
	subs        map[*Subscription]struct{}
	synced      bool
	lastEmptyAt time.Time
}

type Pool struct {
	dyn     dynamic.Interface
	md      metadata.Interface
	mu      sync.Mutex
	entries map[poolKey]*entry

	nextSubID int64
}

type Subscription struct {
	id        string
	Coal      *stream.Coalescer
	Snap      chan []stream.Op
	subs      []*entry
	done      chan struct{}
	closeOnce sync.Once
}

func (s *Subscription) ID() string                            { return s.id }
func (s *Subscription) Snapshot() <-chan []stream.Op          { return s.Snap }
func (s *Subscription) Deltas() <-chan []stream.Op            { return s.Coal.Out() }

func ParseGVR(s string) (schema.GroupVersionResource, error) {
	parts := strings.Split(s, "/")
	switch len(parts) {
	case 3:
		return schema.GroupVersionResource{Group: parts[0], Version: parts[1], Resource: parts[2]}, nil
	case 2:
		return schema.GroupVersionResource{Group: "", Version: parts[0], Resource: parts[1]}, nil
	default:
		return schema.GroupVersionResource{}, fmt.Errorf("invalid gvr %q (want group/version/resource)", s)
	}
}

func New(restCfg *rest.Config) (*Pool, error) {
	dyn, err := dynamic.NewForConfig(restCfg)
	if err != nil {
		return nil, err
	}
	md, err := metadata.NewForConfig(restCfg)
	if err != nil {
		return nil, err
	}
	p := &Pool{dyn: dyn, md: md, entries: map[poolKey]*entry{}}
	go p.sweeper()
	return p, nil
}

func (p *Pool) Subscribe(ctx context.Context, gvrStr string, namespaces []string, selector string) (*Subscription, error) {
	if p.md == nil {
		return nil, fmt.Errorf("metadata client unavailable")
	}
	gvr, err := ParseGVR(gvrStr)
	if err != nil {
		return nil, err
	}
	sub := &Subscription{
		id:   fmt.Sprintf("sub-%d", time.Now().UnixNano()),
		Coal: stream.NewCoalescer(),
		Snap: make(chan []stream.Op, 4),
		done: make(chan struct{}),
	}
	go sub.Coal.Run(16 * time.Millisecond)

	nsList := namespaces
	if len(nsList) == 0 {
		nsList = []string{metav1.NamespaceAll}
	}
	for _, ns := range nsList {
		e, err := p.entryFor(poolKey{gvr: gvr, namespace: ns, selector: selector})
		if err != nil {
			return nil, err
		}
		e.mu.Lock()
		e.subs[sub] = struct{}{}
		e.lastEmptyAt = time.Time{}
		synced := e.synced
		e.mu.Unlock()
		sub.subs = append(sub.subs, e)
		if synced {
			e.deliverSnapshot(sub)
		}
	}
	go func() {
		<-ctx.Done()
		p.unsubscribe(sub)
	}()
	return sub, nil
}

func (p *Pool) unsubscribe(sub *Subscription) {
	sub.closeOnce.Do(func() {
		for _, e := range sub.subs {
			e.mu.Lock()
			delete(e.subs, sub)
			if len(e.subs) == 0 {
				e.lastEmptyAt = time.Now()
			}
			e.mu.Unlock()
		}
		sub.Coal.Close()
		close(sub.done)
	})
}

func (p *Pool) entryFor(key poolKey) (*entry, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if e, ok := p.entries[key]; ok {
		return e, nil
	}
	factoryOptsNs := key.namespace
	var tweak metadatainformer.TweakListOptionsFunc
	if key.selector != "" {
		tweak = func(o *metav1.ListOptions) { o.LabelSelector = key.selector }
	}
	factory := metadatainformer.NewFilteredSharedInformerFactory(p.md, 0, factoryOptsNs, tweak)
	inf := factory.ForResource(key.gvr)
	e := &entry{
		key:      key,
		informer: inf.Informer(),
		fanout:   make(chan stream.Op, 2048),
		stop:     make(chan struct{}),
		subs:     map[*Subscription]struct{}{},
	}
	inf.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj any) { e.emit(stream.OpAdd, obj) },
		UpdateFunc: func(_, newObj any) { e.emit(stream.OpModify, newObj) },
		DeleteFunc: func(obj any) { e.emit(stream.OpDelete, obj) },
	})
	p.entries[key] = e
	go func() {
		defer close(e.fanout)
		inf.Informer().Run(e.stop)
	}()
	go func() {
		ok := cache.WaitForCacheSync(e.stop, inf.Informer().HasSynced)
		e.mu.Lock()
		e.synced = ok
		subs := make([]*Subscription, 0, len(e.subs))
		for s := range e.subs {
			subs = append(subs, s)
		}
		e.mu.Unlock()
		if !ok {
			return
		}
		for _, s := range subs {
			e.deliverSnapshot(s)
		}
	}()
	go p.drainFanout(e)
	return e, nil
}

func (e *entry) emit(opType string, obj any) {
	meta, ok := obj.(*metav1.PartialObjectMetadata)
	if !ok {
		if tomb, ok := obj.(cache.DeletedFinalStateUnknown); ok {
			meta, ok = tomb.Obj.(*metav1.PartialObjectMetadata)
		}
		if !ok {
			return
		}
	}
	m, err := toMap(meta)
	if err != nil {
		return
	}
	key, err := stream.ObjectKey(m)
	if err != nil {
		return
	}
	select {
	case e.fanout <- stream.Op{Op: opType, Key: key, Obj: m}:
	default:
	}
}

func (p *Pool) drainFanout(e *entry) {
	for op := range e.fanout {
		e.mu.RLock()
		subs := make([]*Subscription, 0, len(e.subs))
		for s := range e.subs {
			subs = append(subs, s)
		}
		e.mu.RUnlock()
		for _, s := range subs {
			s.Coal.Push(op)
		}
	}
}

func (e *entry) deliverSnapshot(sub *Subscription) {
	items := e.informer.GetIndexer().List()
	ops := make([]stream.Op, 0, len(items))
	rv := ""
	for _, it := range items {
		meta, ok := it.(*metav1.PartialObjectMetadata)
		if !ok {
			continue
		}
		m, err := toMap(meta)
		if err != nil {
			continue
		}
		key, err := stream.ObjectKey(m)
		if err != nil {
			continue
		}
		rv = stream.ObjectRV(m)
		ops = append(ops, stream.Op{Op: stream.OpAdd, Key: key, Obj: m})
	}
	select {
	case sub.Snap <- ops:
	case <-sub.done:
	}
	_ = rv
}

func toMap(o any) (map[string]any, error) {
	b, err := json.Marshal(o)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (p *Pool) sweeper() {
	t := time.NewTicker(sweepEvery)
	defer t.Stop()
	for range t.C {
		now := time.Now()
		p.mu.Lock()
		for k, e := range p.entries {
			e.mu.RLock()
			empty := len(e.subs) == 0 && e.lastEmptyAt.Add(evictAfter).Before(now)
			e.mu.RUnlock()
			if empty {
				delete(p.entries, k)
				close(e.stop)
			}
		}
		p.mu.Unlock()
	}
}
