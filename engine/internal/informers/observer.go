package informers

import (
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/cache"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/RajaSardar/kubebay/engine/internal/timeline"
)

// Observer receives what the pool's informers see, for the desktop change
// timeline (backlog 82). It watches passively: the pool starts no informer
// for it, so it only sees kinds a page has open, and only while open.
type Observer interface {
	// Active is false while nothing is recording, so the pool skips the work.
	Active() bool
	Observe(cluster string, ob timeline.Observed)
	WatchStart(cluster, kind, namespace string)
	WatchEnd(cluster, kind, namespace, reason string)
}

// SetObserver attaches o to this pool, before any subscription. Entries
// watching through a label selector are not reported: they see part of a
// kind, so neither their changes nor their coverage would be honest.
func (p *Pool) SetObserver(cluster string, o Observer) {
	p.mu.Lock()
	p.obs, p.obsCluster = o, cluster
	p.mu.Unlock()
}

func asMap(o any) map[string]any {
	switch v := o.(type) {
	case *unstructured.Unstructured:
		return v.Object
	case *metav1.PartialObjectMetadata:
		m, err := runtime.DefaultUnstructuredConverter.ToUnstructured(v)
		if err != nil {
			return nil
		}
		return m
	}
	return nil
}

// toObserved converts an informer event. old may be a tombstone from a
// relist (the delete happened while the watch was down), which marks the
// change as seen after a gap.
func toObserved(op string, old, nw any, group, version, resource, mode string) (timeline.Observed, bool) {
	ob := timeline.Observed{Group: group, Version: version, Resource: resource, Op: op, MetadataOnly: mode == ModeMetadata}
	if ts, ok := old.(cache.DeletedFinalStateUnknown); ok {
		old, ob.AfterGap = ts.Obj, true
	}
	if old != nil {
		if ob.Old = asMap(old); ob.Old == nil {
			return ob, false
		}
	}
	if nw != nil {
		if ob.New = asMap(nw); ob.New == nil {
			return ob, false
		}
	}
	if ob.Old == nil && ob.New == nil {
		return ob, false
	}
	if k := kindOf(ob); k != "PartialObjectMetadata" {
		ob.ObjKind = k
	}
	return ob, true
}

func kindOf(ob timeline.Observed) string {
	m := ob.New
	if m == nil {
		m = ob.Old
	}
	k, _ := m["kind"].(string)
	return k
}

// observe reports one event of e to the pool's observer, if there is an
// active one and the entry is a whole-kind watch.
func (p *Pool) observe(e *entry, op string, old, nw any) {
	obs, cluster := p.observer()
	if obs == nil || e.key.selector != "" || !obs.Active() || timeline.Denied(e.key.gvr.Group, e.key.gvr.Resource, "") {
		return
	}
	if ob, ok := toObserved(op, old, nw, e.key.gvr.Group, e.key.gvr.Version, e.key.gvr.Resource, e.key.mode); ok {
		obs.Observe(cluster, ob)
	}
}

func (p *Pool) observer() (Observer, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.obs, p.obsCluster
}

// watchSpan opens the entry's coverage once it has synced and closes it when
// the entry stops, with why.
func (p *Pool) watchSpan(e *entry) {
	obs, cluster := p.observer()
	if obs == nil || e.key.selector != "" {
		return
	}
	kind := timeline.KindFor(e.key.gvr.Resource, "")
	if timeline.Denied(e.key.gvr.Group, e.key.gvr.Resource, kind) {
		return
	}
	obs.WatchStart(cluster, kind, e.key.namespace)
	<-e.stop
	reason := "no page was watching, or the cluster was disconnected"
	e.mu.RLock()
	if e.failed != "" {
		reason = "access was refused by the cluster (RBAC)"
	}
	e.mu.RUnlock()
	obs.WatchEnd(cluster, kind, e.key.namespace, reason)
}
