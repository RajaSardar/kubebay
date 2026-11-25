package informers

import (
	"context"
	"reflect"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// Snapshots hand out the cache's own objects and a shared op's encoding is
// made once, whenever the first subscription sends it: both are right only
// if an object, once it is in the cache, is never changed in place. An
// update must replace it. This pins that on the real path (transform,
// informer, fanout to two subscriptions).
func TestCacheObjectsAreReplacedNotChanged(t *testing.T) {
	events := map[string]chan map[string]any{"shop": make(chan map[string]any, 1)}
	f := fakeDeployments{items: map[string][]map[string]any{"shop": {deployment("shop", "api")}}, events: events}
	p, err := New(&rest.Config{Host: f.serve(t).URL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	var subs []*Subscription
	for i := 0; i < 2; i++ {
		s, err := p.Subscribe(context.Background(), "apps/v1/deployments", []string{"shop"}, "", ModeFull)
		if err != nil {
			t.Fatal(err)
		}
		subs = append(subs, s)
	}

	var held map[string]any
	select {
	case snap := <-subs[0].Snapshot():
		ops := snap.All()
		if len(ops) != 1 {
			t.Fatalf("snapshot = %v", names(ops))
		}
		held = ops[0].Obj
	case <-time.After(5 * time.Second):
		t.Fatal("no snapshot")
	}
	<-subs[1].Snapshot()
	before := runtime.DeepCopyJSON(held)

	next := func(rv string, replicas int64) stream.Op {
		t.Helper()
		u := deployment("shop", "api")
		u["metadata"].(map[string]any)["resourceVersion"] = rv
		u["spec"] = map[string]any{"replicas": replicas}
		events["shop"] <- u
		for {
			select {
			case ops := <-subs[0].Deltas():
				for _, op := range ops {
					if op.Key == "shop/api" && op.Obj["metadata"].(map[string]any)["resourceVersion"] == rv {
						return op
					}
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("no delta for resourceVersion %s", rv)
			}
		}
	}
	first := next("4", 2)
	if !first.Shared() {
		t.Fatal("an update to two subscriptions is not a shared op")
	}
	firstCopy := runtime.DeepCopyJSON(first.Obj)
	next("5", 3)

	if !reflect.DeepEqual(held, before) {
		t.Errorf("an update changed the snapshot's object in place:\n now %v\nwas %v", held, before)
	}
	if !reflect.DeepEqual(first.Obj, firstCopy) {
		t.Errorf("a later update changed a shared op's object in place:\n now %v\nwas %v", first.Obj, firstCopy)
	}
}
