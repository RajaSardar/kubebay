package informers

import (
	"runtime"
	"testing"
	"time"
	"weak"

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
	sub.offer(e, []stream.Op{{Op: stream.OpAdd, Key: e.key.namespace + "/api", Obj: map[string]any{"held": s}}})
	return weak.Make(s)
}

func receive(t *testing.T, sub *Subscription) {
	t.Helper()
	select {
	case snap := <-sub.Snapshot():
		if len(snap) == 0 {
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
		Snap:    make(chan []stream.Op, 4),
		subs:    []*entry{shop, payments},
		expect:  2,
		got:     map[*entry][]stream.Op{},
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
