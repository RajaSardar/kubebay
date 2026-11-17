package clusters

import (
	"sort"
	"testing"
	"time"
)

func sorted(s []string) []string { sort.Strings(s); return s }

func TestProbeTargetsOnlyConnectedWhenNothingRequested(t *testing.T) {
	m := testManager(t)
	now := time.Now()
	if got := m.probeTargets(now, 10); len(got) != 0 {
		t.Fatalf("nothing connected, nothing requested: probed %v", got)
	}
	_ = m.Connect("alpha")
	got := m.probeTargets(now, 10)
	if len(got) != 1 || got[0] != "alpha" {
		t.Fatalf("connected only: got %v", got)
	}
}

func TestProbeTargetsOnDemandSkipsFreshAndCapsBatch(t *testing.T) {
	m := testManager(t)
	now := time.Now()
	fresh := now.Add(-time.Minute)
	m.mu.Lock()
	m.entries["mid"].cluster.CheckedAt = &fresh
	m.mu.Unlock()

	m.RequestReachability()
	if got := m.probeTargets(now, 1); len(got) != 1 {
		t.Fatalf("batch of 1: got %v", got)
	}
	got := sorted(m.probeTargets(now, 10))
	if len(got) != 2 || got[0] != "alpha" || got[1] != "zeta" { // mid is fresh, broken has no client
		t.Fatalf("on demand: got %v", got)
	}
	old := now.Add(-6 * time.Minute)
	m.mu.Lock()
	m.entries["mid"].cluster.CheckedAt = &old
	m.mu.Unlock()
	m.RequestReachability()
	if g := m.probeTargets(now, 10); len(g) != 3 {
		t.Fatalf("stale cluster should be re-probed: %v", g)
	}
}

func TestProbeTargetsRequestClearsWhenNothingDue(t *testing.T) {
	m := testManager(t)
	m.RequestReachability()
	n := time.Now()
	m.mu.Lock()
	for _, id := range []string{"alpha", "mid", "zeta"} {
		m.entries[id].cluster.CheckedAt = &n
	}
	m.mu.Unlock()
	if got := m.probeTargets(n, 10); len(got) != 0 {
		t.Fatalf("all fresh: %v", got)
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.wantAll {
		t.Error("request should clear once nothing is stale")
	}
}
