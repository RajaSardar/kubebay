package informers

import (
	"fmt"
	"runtime"
	"slices"
	"testing"
	"time"
	"weak"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// A subscription merges its namespaces' snapshots into one, then hands it to
// the client. It must not keep the objects after that: a page left open on
// 20k pods held a second copy of every one (about 190 MB) for as long as it
// stayed subscribed.

type sentinel struct{ _ [1 << 10]byte }

// offerOne gives sub a one-object snapshot from e and returns a weak pointer
// to something only that object holds.
func offerOne(sub *Subscription, e *entry) weak.Pointer[sentinel] {
	s := new(sentinel)
	sub.offer(e, []any{&unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"namespace": e.key.namespace, "name": "api"},
		"held":     s,
	}}})
	return weak.Make(s)
}

func receive(t *testing.T, sub *Subscription) {
	t.Helper()
	select {
	case snap := <-sub.Snapshot():
		if snap.Len() == 0 {
			t.Fatal("empty snapshot")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no snapshot")
	}
}

func TestASentSnapshotIsntKeptBySubscription(t *testing.T) {
	shop := &entry{key: poolKey{namespace: "shop"}}
	payments := &entry{key: poolKey{namespace: "payments"}}
	sub := &Subscription{
		Snap:    make(chan stream.Snapshot, 4),
		subs:    []*entry{shop, payments},
		expect:  2,
		got:     map[*entry][]any{},
		refused: map[*entry]bool{},
		done:    make(chan struct{}),
	}
	held := []weak.Pointer[sentinel]{offerOne(sub, shop), offerOne(sub, payments)}
	receive(t, sub)

	runtime.GC()
	for i, w := range held {
		if w.Value() != nil {
			t.Errorf("object %d of the sent snapshot is still reachable from the subscription", i)
		}
	}
	// Still one snapshot: a namespace answering again doesn't send another.
	_ = offerOne(sub, shop)
	select {
	case <-sub.Snapshot():
		t.Fatal("a second snapshot after shop answered again")
	case <-time.After(100 * time.Millisecond):
	}
	runtime.KeepAlive(sub)
}

// The informer's initial list reaches a subscriber once, in the snapshot.
// Each object of it was also made a delta as it arrived: a second map of
// every object at the sync's peak, sent ahead of a snapshot that replaced it.
func TestTheInitialListArrivesOnlyInTheSnapshot(t *testing.T) {
	events := map[string]chan map[string]any{"shop": make(chan map[string]any, 1)}
	sub := subscribeFake(t, fakeDeployments{
		items:  map[string][]map[string]any{"shop": {deployment("shop", "api"), deployment("shop", "web")}},
		events: events,
	}, "shop")

	select {
	case snap := <-sub.Snapshot():
		if got := names(snap.All()); fmt.Sprint(got) != "[shop/api shop/web]" {
			t.Fatalf("snapshot = %v, want the initial list", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no snapshot")
	}

	events["shop"] <- deployment("shop", "cart")
	var deltas []string
	deadline := time.After(5 * time.Second)
	for !slices.Contains(deltas, "shop/cart") {
		select {
		case ops := <-sub.Deltas():
			deltas = append(deltas, names(ops)...)
		case <-deadline:
			t.Fatalf("no delta for shop/cart, a change after the sync; got %v", deltas)
		}
	}
	if fmt.Sprint(deltas) != "[shop/cart]" {
		t.Fatalf("deltas = %v, want only shop/cart: the initial list is in the snapshot", deltas)
	}
}
