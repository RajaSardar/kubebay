package timeline

import (
	"runtime"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/perffixture"
)

const scalePods = 2000

func churnPairs(n int) (old, nw []map[string]any) {
	for i := 0; i < n; i++ {
		p := perffixture.Pod(i)
		old = append(old, p)
		nw = append(nw, perffixture.Churn(p, i+1))
	}
	return
}

// One kubelet status write on one pod.
func BenchmarkSummarizePodChurn(b *testing.B) {
	old, nw := churnPairs(64)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Summarize(old[i%64], nw[i%64])
	}
}

// A heartbeat-only write: nothing but bookkeeping changed, so the result is
// empty and the caller drops it.
func BenchmarkSummarizePodHeartbeatOnly(b *testing.B) {
	p := perffixture.Pod(1)
	q := perffixture.DeepCopy(p)
	md := q["metadata"].(map[string]any)
	md["resourceVersion"] = "1001"
	md["managedFields"].([]any)[2].(map[string]any)["time"] = "2026-11-01T10:05:00Z"
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Summarize(p, q)
	}
}

func BenchmarkManagerOfPodChurn(b *testing.B) {
	old, nw := churnPairs(64)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ManagerOf(old[i%64], nw[i%64])
	}
}

// The whole Recorder.Observe for 2,000 pods churning in turn.
func BenchmarkRecorderObserve2000Pods(b *testing.B) {
	old, nw := churnPairs(scalePods)
	clock := time.Unix(1_800_000_000, 0)
	r := NewRecorder(NewMemStore(), Options{Now: func() time.Time { return clock }})
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		k := i % scalePods
		// a fresh resourceVersion per call so de-dup doesn't short-circuit
		nw[k]["metadata"].(map[string]any)["resourceVersion"] = itoa(2000 + i)
		r.Observe("c1", Observed{Resource: "pods", Version: "v1", ObjKind: "Pod", Op: OpUpdate, Old: old[k], New: nw[k]})
		if i%scalePods == 0 {
			clock = clock.Add(time.Second)
			_ = r.Flush()
		}
	}
}

// Retained heap of the recorder itself after 2,000 pods churned for two
// minutes at one write per pod every five seconds.
func TestRecorderRetainedHeap2000Pods(t *testing.T) {
	old, nw := churnPairs(scalePods)
	clock := time.Unix(1_800_000_000, 0)
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	r := NewRecorder(NewMemStore(), Options{Now: func() time.Time { return clock }})
	n := 0
	for tick := 0; tick < 24; tick++ { // 24 × 5s = 2 min
		for k := 0; k < scalePods; k++ {
			n++
			nw[k]["metadata"].(map[string]any)["resourceVersion"] = itoa(5000 + n)
			r.Observe("c1", Observed{Resource: "pods", Version: "v1", ObjKind: "Pod", Op: OpUpdate, Old: old[k], New: nw[k]})
		}
		clock = clock.Add(5 * time.Second)
		_ = r.Flush()
	}
	runtime.GC()
	runtime.ReadMemStats(&after)
	r.mu.Lock()
	bursts, seen, pending := len(r.bursts), len(r.seen), len(r.pending)
	r.mu.Unlock()
	delta := float64(int64(after.HeapInuse)-int64(before.HeapInuse)) / (1 << 20)
	t.Logf("recorder: bursts=%d seen=%d pending=%d heapDelta=%.1f MiB (includes MemStore rows)", bursts, seen, pending, delta)
	// Measured 3.8 MiB (bursts 500, seen 8,192, pending 0); the ceilings
	// catch a leak, not noise.
	if seen > seenCap || pending > DefaultMaxBuffer || bursts > scalePods {
		t.Errorf("recorder grew: bursts=%d seen=%d pending=%d", bursts, seen, pending)
	}
	if delta > 32 {
		t.Errorf("recorder retained %.1f MiB after 2 minutes of churn, budget 32 MiB", delta)
	}
	runtime.KeepAlive(old)
	runtime.KeepAlive(nw)
}
