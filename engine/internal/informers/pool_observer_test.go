package informers

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"

	"github.com/RajaSardar/kubebay/engine/internal/timeline"
)

type obsLog struct {
	mu     sync.Mutex
	events []timeline.Observed
	starts []string
	ends   []string
	active bool
}

func (o *obsLog) Active() bool { return o.active }
func (o *obsLog) Observe(cluster string, ob timeline.Observed) {
	o.mu.Lock()
	o.events = append(o.events, ob)
	o.mu.Unlock()
}
func (o *obsLog) WatchStart(c, k, ns string) {
	o.mu.Lock()
	o.starts = append(o.starts, fmt.Sprintf("%s/%s/%s", c, k, ns))
	o.mu.Unlock()
}
func (o *obsLog) WatchEnd(c, k, ns, reason string) {
	o.mu.Lock()
	o.ends = append(o.ends, fmt.Sprintf("%s/%s/%s:%s", c, k, ns, reason))
	o.mu.Unlock()
}
func (o *obsLog) snap() (ev []timeline.Observed, st, en []string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append(ev, o.events...), append(st, o.starts...), append(en, o.ends...)
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(10 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("timed out: %s", what)
}

func observedPool(t *testing.T, f fakeDeployments, o *obsLog, selector, mode string) (*Pool, *Subscription) {
	t.Helper()
	p, err := New(&rest.Config{Host: f.serve(t).URL})
	if err != nil {
		t.Fatal(err)
	}
	p.SetObserver("c1", o)
	t.Cleanup(p.Close)
	sub, err := p.Subscribe(context.Background(), "apps/v1/deployments", []string{"shop"}, selector, mode)
	if err != nil {
		t.Fatal(err)
	}
	return p, sub
}

func TestPoolReportsCoverageAndLiveChangesToTheObserver(t *testing.T) {
	o := &obsLog{active: true}
	events := map[string]chan map[string]any{"shop": make(chan map[string]any, 1)}
	p, _ := observedPool(t, fakeDeployments{items: map[string][]map[string]any{"shop": {deployment("shop", "api")}}, events: events}, o, "", ModeFull)
	waitFor(t, "watch start", func() bool { _, st, _ := o.snap(); return len(st) == 1 })
	if _, st, _ := o.snap(); st[0] != "c1/Deployment/shop" {
		t.Errorf("start: %v", st)
	}
	if ev, _, _ := o.snap(); len(ev) != 0 {
		t.Errorf("the initial list was recorded as changes: %d", len(ev))
	}
	events["shop"] <- deployment("shop", "cart")
	waitFor(t, "add", func() bool { ev, _, _ := o.snap(); return len(ev) == 1 })
	ev, _, _ := o.snap()
	if ev[0].Op != timeline.OpAdd || ev[0].Resource != "deployments" || ev[0].Group != "apps" || ev[0].MetadataOnly || ev[0].New["metadata"].(map[string]any)["name"] != "cart" {
		t.Errorf("%+v", ev[0])
	}
	p.Close()
	waitFor(t, "watch end", func() bool { _, _, en := o.snap(); return len(en) == 1 })
}

func TestPoolDoesNotObserveASelectorSubsetOrAnInactiveRecorder(t *testing.T) {
	o := &obsLog{active: true}
	events := map[string]chan map[string]any{"shop": make(chan map[string]any, 1)}
	observedPool(t, fakeDeployments{items: map[string][]map[string]any{"shop": {}}, events: events}, o, "app=web", ModeFull)
	time.Sleep(300 * time.Millisecond)
	if ev, st, _ := o.snap(); len(ev)+len(st) != 0 {
		t.Errorf("a label-selected watch covers part of a kind and must claim nothing: %v %v", ev, st)
	}

	off := &obsLog{active: false}
	events2 := map[string]chan map[string]any{"shop": make(chan map[string]any, 1)}
	observedPool(t, fakeDeployments{items: map[string][]map[string]any{"shop": {}}, events: events2}, off, "", ModeFull)
	events2["shop"] <- deployment("shop", "x")
	time.Sleep(300 * time.Millisecond)
	if ev, _, _ := off.snap(); len(ev) != 0 {
		t.Error("an inactive observer received events")
	}
}

func TestToObservedUnwrapsTombstonesAndMarksMetadataOnly(t *testing.T) {
	u := &unstructured.Unstructured{Object: deployment("shop", "gone")}
	ob, ok := toObserved(timeline.OpDelete, cache.DeletedFinalStateUnknown{Key: "shop/gone", Obj: u}, nil, "apps", "v1", "deployments", ModeFull)
	if !ok || !ob.AfterGap || ob.Old["metadata"].(map[string]any)["name"] != "gone" {
		t.Errorf("%+v %v", ob, ok)
	}
	pm := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{Name: "p", Namespace: "ns", UID: "u1"}}
	ob, ok = toObserved(timeline.OpAdd, nil, pm, "", "v1", "pods", ModeMetadata)
	if !ok || !ob.MetadataOnly || ob.New["metadata"].(map[string]any)["name"] != "p" {
		t.Errorf("%+v %v", ob, ok)
	}
	if _, ok := toObserved(timeline.OpAdd, nil, "junk", "", "v1", "pods", ModeFull); ok {
		t.Error("junk accepted")
	}
}
