package informers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/metadata"
	"k8s.io/client-go/metadata/metadatainformer"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

const (
	evictAfter = 5 * time.Minute
	sweepEvery = time.Minute

	ModeMetadata = "metadata"
	ModeFull     = "full"
)

type poolKey struct {
	gvr       schema.GroupVersionResource
	namespace string
	selector  string
	mode      string
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
	// failed is why the entry stopped for good (RBAC forbids the list);
	// a subscriber arriving after that is ended with it at once.
	failed string
}

type Pool struct {
	dyn     dynamic.Interface
	md      metadata.Interface
	mu      sync.Mutex
	entries map[poolKey]*entry
	closed  bool
	done    chan struct{}
}

type Subscription struct {
	id   string
	Coal *stream.Coalescer
	Snap chan []stream.Op
	deny chan stream.Denial
	mu   sync.Mutex // guards the fields below: entries answer from their own goroutines
	subs []*entry
	// One snapshot per subscription: each namespace's entry answers once,
	// with its snapshot or a refusal, and the merged snapshot goes out when
	// all expect of them have.
	expect    int
	got       map[*entry][]stream.Op
	refused   map[*entry]bool
	sent      bool
	done      chan struct{}
	closeOnce sync.Once
	reason    atomic.Value // string: why the engine ended it, "" if the client did
}

func (s *Subscription) ID() string                   { return s.id }
func (s *Subscription) Snapshot() <-chan []stream.Op { return s.Snap }
func (s *Subscription) Deltas() <-chan []stream.Op   { return s.Coal.Out() }

// Denials names the namespaces of the subscription that RBAC refuses.
func (s *Subscription) Denials() <-chan stream.Denial { return s.deny }

// mergedLocked is the subscription's one snapshot, once every namespace has
// answered and it hasn't gone out yet. s.mu must be held.
func (s *Subscription) mergedLocked() ([]stream.Op, bool) {
	if s.sent || len(s.got)+len(s.refused) < s.expect || len(s.got) == 0 {
		return nil, false
	}
	s.sent = true
	var out []stream.Op
	for _, e := range s.subs {
		out = append(out, s.got[e]...)
	}
	// Each namespace stays marked as answered, but its objects go: holding
	// them would keep a copy of the whole snapshot while the page is open.
	for e := range s.got {
		s.got[e] = nil
	}
	return out, true
}

func (s *Subscription) sendSnapshot(ops []stream.Op) {
	select {
	case s.Snap <- ops:
	case <-s.done:
	}
}

// offer is one namespace's snapshot.
func (s *Subscription) offer(e *entry, ops []stream.Op) {
	s.mu.Lock()
	if _, seen := s.got[e]; seen || s.refused[e] {
		s.mu.Unlock()
		return
	}
	s.got[e] = ops
	merged, ready := s.mergedLocked()
	s.mu.Unlock()
	if ready {
		s.sendSnapshot(merged)
	}
}

// refuse is one namespace refused by RBAC. It reports whether every
// namespace now is, in which case the caller ends the subscription;
// otherwise the namespace is named and the others go on.
func (s *Subscription) refuse(e *entry, message string) (all bool) {
	s.mu.Lock()
	if s.refused[e] {
		s.mu.Unlock()
		return false
	}
	s.refused[e] = true
	delete(s.got, e)
	if len(s.refused) >= s.expect {
		s.mu.Unlock()
		return true
	}
	merged, ready := s.mergedLocked()
	s.mu.Unlock()
	select {
	case s.deny <- stream.Denial{NS: e.key.namespace, Message: message}:
	case <-s.done:
	}
	if ready {
		s.sendSnapshot(merged)
	}
	return false
}

// CloseReason says why the engine ended the subscription; "" when the
// client unsubscribed.
func (s *Subscription) CloseReason() string {
	r, _ := s.reason.Load().(string)
	return r
}

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

func NormalizeMode(m string) string {
	if m == ModeFull {
		return ModeFull
	}
	return ModeMetadata
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
	p := &Pool{dyn: dyn, md: md, entries: map[poolKey]*entry{}, done: make(chan struct{})}
	go p.sweeper()
	return p, nil
}

func (p *Pool) Subscribe(ctx context.Context, gvrStr string, namespaces []string, selector, mode string) (*Subscription, error) {
	gvr, err := ParseGVR(gvrStr)
	if err != nil {
		return nil, err
	}
	mode = NormalizeMode(mode)
	nsList := uniqueNamespaces(namespaces)
	sub := &Subscription{
		id:      fmt.Sprintf("sub-%d", time.Now().UnixNano()),
		Coal:    stream.NewCoalescer(),
		Snap:    make(chan []stream.Op, 4),
		deny:    make(chan stream.Denial, len(nsList)),
		expect:  len(nsList),
		got:     map[*entry][]stream.Op{},
		refused: map[*entry]bool{},
		done:    make(chan struct{}),
	}
	go sub.Coal.Run(16 * time.Millisecond)

	for _, ns := range nsList {
		e, err := p.entryFor(poolKey{gvr: gvr, namespace: ns, selector: selector, mode: mode})
		if err != nil {
			p.unsubscribe(sub)
			return nil, err
		}
		sub.mu.Lock()
		sub.subs = append(sub.subs, e)
		sub.mu.Unlock()
		e.mu.Lock()
		e.subs[sub] = struct{}{}
		e.lastEmptyAt = time.Time{}
		synced, failed := e.synced, e.failed
		e.mu.Unlock()
		if failed != "" {
			if sub.refuse(e, strings.TrimPrefix(failed, stream.ReasonForbidden)) {
				p.end(sub, failed)
				return sub, nil
			}
			continue
		}
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

// Close stops every informer in the pool and ends every open subscription,
// whose Deltas channel then closes. A closed pool refuses new subscriptions.
func (p *Pool) Close() { p.CloseWithReason(stream.ReasonDisconnected) }

// CloseWithReason is Close, telling subscribers why.
func (p *Pool) CloseWithReason(reason string) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	close(p.done)
	entries := p.entries
	p.entries = map[poolKey]*entry{}
	p.mu.Unlock()
	for _, e := range entries {
		e.mu.RLock()
		subs := make([]*Subscription, 0, len(e.subs))
		for s := range e.subs {
			subs = append(subs, s)
		}
		e.mu.RUnlock()
		for _, s := range subs {
			p.end(s, reason)
		}
		close(e.stop)
	}
}

// Closed reports whether Close was called.
func (p *Pool) Closed() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.closed
}

func (p *Pool) unsubscribe(sub *Subscription) { p.end(sub, "") }

// uniqueNamespaces is the subscription's namespaces, each once; none means
// all namespaces.
func uniqueNamespaces(namespaces []string) []string {
	if len(namespaces) == 0 {
		return []string{metav1.NamespaceAll}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(namespaces))
	for _, ns := range namespaces {
		if !seen[ns] {
			seen[ns] = true
			out = append(out, ns)
		}
	}
	return out
}

// forbid retires an entry whose list or watch RBAC forbids: it leaves the
// pool, so a later subscription (after the RBAC changes) lists afresh, and
// its informer stops. A subscriber for whom it was the last namespace left
// is ended with the reason; any other is told which namespace was refused
// and goes on with the rest.
func (p *Pool) forbid(e *entry, reason string) {
	p.mu.Lock()
	owned := p.entries[e.key] == e
	if owned {
		delete(p.entries, e.key)
	}
	p.mu.Unlock()
	e.mu.Lock()
	e.failed = reason
	subs := make([]*Subscription, 0, len(e.subs))
	for s := range e.subs {
		subs = append(subs, s)
	}
	e.mu.Unlock()
	for _, s := range subs {
		if s.refuse(e, strings.TrimPrefix(reason, stream.ReasonForbidden)) {
			p.end(s, reason)
		}
	}
	// Whoever takes the entry out of the pool stops it, once.
	if owned {
		close(e.stop)
	}
}

func (p *Pool) end(sub *Subscription, reason string) {
	sub.closeOnce.Do(func() {
		sub.reason.Store(reason)
		sub.mu.Lock()
		entries := append([]*entry(nil), sub.subs...)
		sub.mu.Unlock()
		for _, e := range entries {
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
	if p.closed {
		return nil, fmt.Errorf("cluster disconnected")
	}
	if e, ok := p.entries[key]; ok {
		return e, nil
	}

	var tweak func(*metav1.ListOptions)
	if key.selector != "" {
		tweak = func(o *metav1.ListOptions) { o.LabelSelector = key.selector }
	}

	var inf cache.SharedIndexInformer
	switch key.mode {
	case ModeFull:
		factory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(p.dyn, 0, key.namespace, tweak)
		inf = factory.ForResource(key.gvr).Informer()
	default:
		factory := metadatainformer.NewFilteredSharedInformerFactory(p.md, 0, key.namespace, tweak)
		inf = factory.ForResource(key.gvr).Informer()
	}

	e := &entry{
		key:      key,
		informer: inf,
		fanout:   make(chan stream.Op, 2048),
		stop:     make(chan struct{}),
		subs:     map[*Subscription]struct{}{},
	}
	// A list RBAC forbids would otherwise be retried forever while the page
	// waits for a sync that never comes.
	_ = inf.SetWatchErrorHandlerWithContext(func(ctx context.Context, r *cache.Reflector, err error) {
		var status apierrors.APIStatus
		if apierrors.IsForbidden(err) && errors.As(err, &status) {
			p.forbid(e, stream.ReasonForbidden+status.Status().Message)
			return
		}
		cache.DefaultWatchErrorHandler(ctx, r, err)
	})
	inf.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj any) { e.emit(stream.OpAdd, obj) },
		UpdateFunc: func(_, newObj any) { e.emit(stream.OpModify, newObj) },
		DeleteFunc: func(obj any) { e.emit(stream.OpDelete, obj) },
	})
	p.entries[key] = e
	go func() {
		defer close(e.fanout)
		inf.Run(e.stop)
	}()
	go func() {
		ok := cache.WaitForCacheSync(e.stop, inf.HasSynced)
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

func unwrap(obj any) map[string]any {
	switch o := obj.(type) {
	case *unstructured.Unstructured:
		return o.UnstructuredContent()
	case *metav1.PartialObjectMetadata:
		return jsonToMap(o)
	case cache.DeletedFinalStateUnknown:
		if inner := o.Obj; inner != nil {
			return unwrap(inner)
		}
	}
	return nil
}

func jsonToMap(v any) map[string]any {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil
	}
	return m
}

func (e *entry) emit(opType string, obj any) {
	m := unwrap(obj)
	if m == nil {
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
	for _, it := range items {
		m := unwrap(it)
		if m == nil {
			continue
		}
		key, err := stream.ObjectKey(m)
		if err != nil {
			continue
		}
		ops = append(ops, stream.Op{Op: stream.OpAdd, Key: key, Obj: m})
	}
	sub.offer(e, ops)
}

func (p *Pool) sweeper() {
	t := time.NewTicker(sweepEvery)
	defer t.Stop()
	for {
		select {
		case <-p.done:
			return
		case <-t.C:
		}
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
