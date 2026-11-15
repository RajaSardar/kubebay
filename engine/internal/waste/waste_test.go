package waste

import (
	"testing"
	"time"
)

func TestPercentile(t *testing.T) {
	cases := []struct {
		name   string
		values []int64
		p      float64
		want   int64
	}{
		{"empty returns 0", []int64{}, 0.95, 0},
		{"single value", []int64{100}, 0.95, 100},
		{"p95 of ten ascending values (nearest-rank)", []int64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}, 0.95, 10},
		{"p50 of ten ascending values", []int64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}, 0.5, 5},
		{"unsorted input is sorted first", []int64{5, 1, 4, 2, 3}, 1.0, 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := percentile(tc.values, tc.p); got != tc.want {
				t.Errorf("percentile(%v, %v) = %d, want %d", tc.values, tc.p, got, tc.want)
			}
		})
	}
}

func TestRingBuffer_AddAndPercentile(t *testing.T) {
	rb := newRingBuffer(3)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rb.add(Sample{Time: base, CPUMillis: 100, MemBytes: 1000})
	rb.add(Sample{Time: base.Add(time.Minute), CPUMillis: 300, MemBytes: 3000})
	rb.add(Sample{Time: base.Add(2 * time.Minute), CPUMillis: 200, MemBytes: 2000})

	cpu, mem := rb.percentileCPUMem(1.0)
	if cpu != 300 {
		t.Errorf("p100 cpu = %d, want 300", cpu)
	}
	if mem != 3000 {
		t.Errorf("p100 mem = %d, want 3000", mem)
	}
}

func TestRingBuffer_EvictsOldestPastCapacity(t *testing.T) {
	rb := newRingBuffer(2)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rb.add(Sample{Time: base, CPUMillis: 999, MemBytes: 999})
	rb.add(Sample{Time: base.Add(time.Minute), CPUMillis: 100, MemBytes: 100})
	rb.add(Sample{Time: base.Add(2 * time.Minute), CPUMillis: 200, MemBytes: 200})

	if rb.count() != 2 {
		t.Fatalf("count = %d, want 2 (capacity)", rb.count())
	}
	cpu, _ := rb.percentileCPUMem(1.0)
	if cpu != 200 {
		t.Errorf("max cpu after eviction = %d, want 200 (999 should have been evicted)", cpu)
	}
}

func TestRingBuffer_WindowLabel(t *testing.T) {
	rb := newRingBuffer(180)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rb.add(Sample{Time: base, CPUMillis: 1, MemBytes: 1})
	rb.add(Sample{Time: base.Add(time.Minute), CPUMillis: 1, MemBytes: 1})

	label := rb.windowLabel(base.Add(time.Minute))
	if label == "" {
		t.Fatal("windowLabel should not be empty once there is at least one sample")
	}
	// Must honestly report the actual sample count, not the buffer capacity.
	if !containsAll(label, "2") {
		t.Errorf("windowLabel = %q, want it to mention the sample count (2)", label)
	}
}

func TestRingBuffer_WindowLabelEmpty(t *testing.T) {
	rb := newRingBuffer(10)
	if got := rb.windowLabel(time.Now()); got != "" {
		t.Errorf("windowLabel on empty buffer = %q, want empty", got)
	}
}

func containsAll(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestResolveWorkload(t *testing.T) {
	rsOwners := map[string]ownerRef{
		"rs-uid-1": {Kind: "Deployment", Name: "my-app", UID: "dep-uid-1"},
	}

	t.Run("resolves through a ReplicaSet to its Deployment", func(t *testing.T) {
		pod := podRef{Owner: &ownerRef{Kind: "ReplicaSet", Name: "my-app-abc123", UID: "rs-uid-1"}}
		kind, name, ok := resolveWorkload(pod, rsOwners)
		if !ok || kind != "Deployment" || name != "my-app" {
			t.Errorf("resolveWorkload = (%q, %q, %v), want (Deployment, my-app, true)", kind, name, ok)
		}
	})

	t.Run("resolves a StatefulSet-owned pod directly", func(t *testing.T) {
		pod := podRef{Owner: &ownerRef{Kind: "StatefulSet", Name: "db", UID: "sts-uid-1"}}
		kind, name, ok := resolveWorkload(pod, rsOwners)
		if !ok || kind != "StatefulSet" || name != "db" {
			t.Errorf("resolveWorkload = (%q, %q, %v), want (StatefulSet, db, true)", kind, name, ok)
		}
	})

	t.Run("resolves a DaemonSet-owned pod directly", func(t *testing.T) {
		pod := podRef{Owner: &ownerRef{Kind: "DaemonSet", Name: "node-exporter", UID: "ds-uid-1"}}
		kind, name, ok := resolveWorkload(pod, rsOwners)
		if !ok || kind != "DaemonSet" || name != "node-exporter" {
			t.Errorf("resolveWorkload = (%q, %q, %v), want (DaemonSet, node-exporter, true)", kind, name, ok)
		}
	})

	t.Run("does not resolve a bare pod with no owner", func(t *testing.T) {
		_, _, ok := resolveWorkload(podRef{Owner: nil}, rsOwners)
		if ok {
			t.Error("bare pod should not resolve to a workload")
		}
	})

	t.Run("does not resolve a ReplicaSet whose own Deployment owner is unknown", func(t *testing.T) {
		pod := podRef{Owner: &ownerRef{Kind: "ReplicaSet", Name: "orphan-rs-abc", UID: "unknown-rs-uid"}}
		_, _, ok := resolveWorkload(pod, rsOwners)
		if ok {
			t.Error("a ReplicaSet not in the owner map should not resolve")
		}
	})

	t.Run("does not resolve a Job-owned pod (out of scope, like VPA/Karpenter)", func(t *testing.T) {
		pod := podRef{Owner: &ownerRef{Kind: "Job", Name: "backup-123", UID: "job-uid-1"}}
		_, _, ok := resolveWorkload(pod, rsOwners)
		if ok {
			t.Error("a Job-owned pod should not resolve — Jobs/CronJobs are out of scope")
		}
	})
}
