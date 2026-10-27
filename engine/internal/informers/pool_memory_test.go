package informers

import (
	"testing"
	"time"
)

// What a subscription costs in memory once it's running (KB-02: the engine
// held 2 GB watching 100k pods). Measured in docs/PERFORMANCE.md.

// A subscription's snapshot is a copy of every object it covers. Once it has
// gone out, holding it would keep that copy for as long as the page is open.
func TestTheSnapshotIsLetGoOnceSent(t *testing.T) {
	sub := subscribeFake(t, fakeDeployments{items: map[string][]map[string]any{
		"shop":     {deployment("shop", "api"), deployment("shop", "web")},
		"payments": {deployment("payments", "gateway")},
	}}, "shop", "payments")

	select {
	case snap := <-sub.Snapshot():
		if len(snap) != 3 {
			t.Fatalf("snapshot has %d objects, want 3", len(snap))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no snapshot")
	}
	sub.mu.Lock()
	defer sub.mu.Unlock()
	for e, ops := range sub.got {
		if len(ops) > 0 {
			t.Errorf("after sending, the subscription still holds %d objects from %s", len(ops), e.key.namespace)
		}
	}
}
