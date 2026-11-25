package timeline

import (
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/perffixture"
)

// A namespaced, an all-namespaces and a metadata watch of pods each report
// the same write. The second report is dropped by uid+resourceVersion+op; it
// must be dropped before the diff, not after.
func TestRecorderDuplicateWatchSkipsTheDiff(t *testing.T) {
	p := perffixture.Pod(3)
	q := perffixture.Churn(p, 4)
	clock := time.Unix(1_800_000_000, 0)
	r := NewRecorder(NewMemStore(), Options{Now: func() time.Time { return clock }})
	ob := Observed{Resource: "pods", Version: "v1", ObjKind: "Pod", Op: OpUpdate, Old: p, New: q}
	r.Observe("c1", ob)
	if got := r.Status().Pending; got != 1 {
		t.Fatalf("pending after first report = %d, want 1", got)
	}
	n := testing.AllocsPerRun(100, func() { r.Observe("c1", ob) })
	if got := r.Status().Pending; got != 1 {
		t.Fatalf("pending after duplicates = %d, want 1", got)
	}
	if n > 2 {
		t.Errorf("a duplicate report: %.0f allocs, budget 2 (the diff must not run)", n)
	}
}

// The whole Observe for one pod status write, after the diff fix: about 23
// allocations (it was about 1,090).
func TestRecorderObserveAllocationBudget(t *testing.T) {
	old, nw := churnPairs(64)
	clock := time.Unix(1_800_000_000, 0)
	r := NewRecorder(NewMemStore(), Options{Now: func() time.Time { return clock }})
	i := 0
	n := testing.AllocsPerRun(200, func() {
		k := i % 64
		nw[k]["metadata"].(map[string]any)["resourceVersion"] = itoa(2000 + i)
		i++
		r.Observe("c1", Observed{Resource: "pods", Version: "v1", ObjKind: "Pod", Op: OpUpdate, Old: old[k], New: nw[k]})
	})
	if n > 60 {
		t.Errorf("Observe on a pod status write: %.0f allocs, budget 60 (was about 1,090)", n)
	}
}

// The seen ring keeps the newest seenCap keys: the oldest is forgotten, so
// a report of it is recorded again.
func TestRecorderSeenRingForgetsTheOldest(t *testing.T) {
	clock := time.Unix(1_800_000_000, 0)
	r := NewRecorder(NewMemStore(), Options{Now: func() time.Time { return clock }, MaxBuffer: 3 * seenCap})
	add := func(i int) {
		o := map[string]any{"kind": "ConfigMap", "metadata": map[string]any{"uid": "u" + itoa(i), "resourceVersion": "1", "name": "n"}}
		r.Observe("c1", Observed{Resource: "configmaps", Version: "v1", ObjKind: "ConfigMap", Op: OpAdd, New: o})
	}
	for i := 0; i < seenCap+5; i++ {
		add(i)
	}
	before := r.Status().Pending
	add(seenCap + 4) // still remembered
	if r.Status().Pending != before {
		t.Fatal("a remembered key was recorded twice")
	}
	add(2) // evicted
	if r.Status().Pending != before+1 {
		t.Fatal("an evicted key was not recorded again")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.seen) != seenCap || len(r.seenQ) != seenCap {
		t.Fatalf("seen=%d ring=%d, want %d", len(r.seen), len(r.seenQ), seenCap)
	}
}

// A second watch reporting the same write.
func BenchmarkRecorderObserveDuplicate(b *testing.B) {
	p := perffixture.Pod(3)
	q := perffixture.Churn(p, 4)
	r := NewRecorder(NewMemStore(), Options{})
	ob := Observed{Resource: "pods", Version: "v1", ObjKind: "Pod", Op: OpUpdate, Old: p, New: q}
	r.Observe("c1", ob)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.Observe("c1", ob)
	}
}
