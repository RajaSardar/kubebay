package clusters

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// warmManager has eight contexts c1..c8, a fake clock and a recorder for
// the disconnect hook (what the informer pools and port-forwards hang on).
func warmManager(t *testing.T) (*Manager, *fakeClock, *[]string) {
	t.Helper()
	var b strings.Builder
	b.WriteString("apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://127.0.0.1:1\ncontexts:\n")
	for i := 1; i <= 8; i++ {
		fmt.Fprintf(&b, "- name: c%d\n  context: {cluster: c, user: u}\n", i)
	}
	b.WriteString("users:\n- name: u\n  user: {token: t}\ncurrent-context: c1\n")
	path := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := newManager(slog.New(slog.NewTextHandler(io.Discard, nil)), path, false)
	if err != nil {
		t.Fatal(err)
	}
	clk := &fakeClock{t: time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)}
	m.now = clk.Now
	var mu sync.Mutex
	dropped := &[]string{}
	m.OnDisconnect(func(id string) {
		mu.Lock()
		*dropped = append(*dropped, id)
		mu.Unlock()
	})
	return m, clk, dropped
}

func connectAll(t *testing.T, m *Manager, clk *fakeClock, ids ...string) {
	t.Helper()
	for _, id := range ids {
		if err := m.Connect(id); err != nil {
			t.Fatal(err)
		}
		clk.Advance(time.Minute)
	}
}

func connectedIDs(m *Manager) []string {
	var out []string
	for _, c := range m.List() {
		if c.Connected {
			out = append(out, c.ID)
		}
	}
	sort.Strings(out)
	return out
}

func TestWarmCapEvictsLeastRecentlyUsed(t *testing.T) {
	m, clk, dropped := warmManager(t)
	m.SetWarmPolicy(3, 0)
	connectAll(t, m, clk, "c1", "c2", "c3", "c4")
	if got, want := connectedIDs(m), []string{"c2", "c3", "c4"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("connected = %v, want %v", got, want)
	}
	if !reflect.DeepEqual(*dropped, []string{"c1"}) {
		t.Fatalf("disconnect hooks ran for %v, want [c1]", *dropped)
	}
}

func TestWarmCapSparesActiveAndPinned(t *testing.T) {
	m, clk, _ := warmManager(t)
	m.SetWarmPolicy(3, 0)
	connectAll(t, m, clk, "c1", "c2", "c3")
	m.SetProtected([]string{"c1", "c2"}) // active + a pin: c1 is the oldest
	connectAll(t, m, clk, "c4")
	if got, want := connectedIDs(m), []string{"c1", "c2", "c4"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("connected = %v, want %v (c3 is the only evictable)", got, want)
	}
}

func TestWarmCapNeverEvictsTheClusterBeingConnected(t *testing.T) {
	m, clk, _ := warmManager(t)
	m.SetWarmPolicy(1, 0)
	connectAll(t, m, clk, "c1")
	m.SetProtected([]string{"c1"})
	connectAll(t, m, clk, "c2")
	// Everything else is protected: the cap is soft rather than evicting what
	// the user is looking at or the cluster that was just asked for.
	if got, want := connectedIDs(m), []string{"c1", "c2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("connected = %v, want %v", got, want)
	}
}

func TestReconnectingAConnectedClusterDoesNotRefreshItsAge(t *testing.T) {
	// Every stream (re)subscribe calls Connect; a wake replay would otherwise
	// make all warm clusters look equally fresh.
	m, clk, _ := warmManager(t)
	m.SetWarmPolicy(2, 0)
	connectAll(t, m, clk, "c1", "c2")
	connectAll(t, m, clk, "c1") // a re-subscribe, not a view
	connectAll(t, m, clk, "c3")
	if got, want := connectedIDs(m), []string{"c2", "c3"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("connected = %v, want %v", got, want)
	}
}

func TestTouchRefreshesAge(t *testing.T) {
	m, clk, _ := warmManager(t)
	m.SetWarmPolicy(2, 0)
	connectAll(t, m, clk, "c1", "c2")
	m.Touch("c1")
	connectAll(t, m, clk, "c3")
	if got, want := connectedIDs(m), []string{"c1", "c3"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("connected = %v, want %v", got, want)
	}
}

func TestZeroCapMeansUnlimited(t *testing.T) {
	m, clk, dropped := warmManager(t)
	m.SetWarmPolicy(0, 0)
	connectAll(t, m, clk, "c1", "c2", "c3", "c4", "c5", "c6", "c7")
	if len(connectedIDs(m)) != 7 || len(*dropped) != 0 {
		t.Fatalf("connected %v dropped %v, want all 7 kept", connectedIDs(m), *dropped)
	}
}

func TestEvictedClusterIsListedAsSleepingUntilConnectedAgain(t *testing.T) {
	m, clk, _ := warmManager(t)
	m.SetWarmPolicy(1, 0)
	connectAll(t, m, clk, "c1", "c2")
	sleeping := func(id string) bool {
		for _, c := range m.List() {
			if c.ID == id {
				return c.Sleeping
			}
		}
		t.Fatalf("no cluster %s", id)
		return false
	}
	if !sleeping("c1") || sleeping("c2") {
		t.Fatalf("c1 sleeping=%v c2 sleeping=%v, want true/false", sleeping("c1"), sleeping("c2"))
	}
	connectAll(t, m, clk, "c1")
	if sleeping("c1") {
		t.Fatal("c1 still sleeping after it connected again")
	}
	// A cluster the user disconnected is not asleep, it is simply off.
	_ = m.Disconnect("c1")
	if sleeping("c1") {
		t.Fatal("a user disconnect must not show as sleeping")
	}
}

func TestIdleEvictionCoolsUnviewedClustersOnly(t *testing.T) {
	m, clk, dropped := warmManager(t)
	m.SetWarmPolicy(5, 30*time.Minute)
	connectAll(t, m, clk, "c1", "c2", "c3")
	m.SetProtected([]string{"c3"}) // the active one
	clk.Advance(25 * time.Minute)
	if got := m.EvictIdle(); len(got) != 0 {
		t.Fatalf("evicted %v before the idle limit", got)
	}
	clk.Advance(10 * time.Minute)
	got := m.EvictIdle()
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"c1", "c2"}) {
		t.Fatalf("evicted %v, want [c1 c2]", got)
	}
	if want := []string{"c3"}; !reflect.DeepEqual(connectedIDs(m), want) {
		t.Fatalf("connected = %v, want %v", connectedIDs(m), want)
	}
	if len(*dropped) != 2 {
		t.Fatalf("hooks ran for %v", *dropped)
	}
}

func TestIdleEvictionOffWhenZero(t *testing.T) {
	m, clk, _ := warmManager(t)
	m.SetWarmPolicy(5, 0)
	connectAll(t, m, clk, "c1")
	clk.Advance(24 * time.Hour)
	if got := m.EvictIdle(); len(got) != 0 {
		t.Fatalf("evicted %v with idle eviction off", got)
	}
}

func TestProtectingAClusterCountsAsUse(t *testing.T) {
	m, clk, _ := warmManager(t)
	m.SetWarmPolicy(5, 30*time.Minute)
	connectAll(t, m, clk, "c1")
	clk.Advance(29 * time.Minute)
	m.SetProtected([]string{"c1"}) // the user switched to it
	m.SetProtected(nil)            // and away again
	clk.Advance(2 * time.Minute)
	if got := m.EvictIdle(); len(got) != 0 {
		t.Fatalf("evicted %v two minutes after it was last viewed", got)
	}
}

func TestWarmPolicyGetter(t *testing.T) {
	m, _, _ := warmManager(t)
	m.SetWarmPolicy(4, 12*time.Minute)
	c, idle := m.WarmPolicy()
	if c != 4 || idle != 12*time.Minute {
		t.Fatalf("WarmPolicy() = %d,%v", c, idle)
	}
}

func TestLoweringWarmCapSleepsExtrasAtOnce(t *testing.T) {
	m, clk, dropped := warmManager(t)
	m.SetWarmPolicy(5, 0)
	connectAll(t, m, clk, "c1", "c2", "c3", "c4", "c5")
	m.SetProtected([]string{"c5"})
	m.SetWarmPolicy(2, 0)
	if got, want := connectedIDs(m), []string{"c4", "c5"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("connected = %v, want %v", got, want)
	}
	if len(*dropped) != 3 {
		t.Fatalf("disconnect hooks ran for %v, want 3 clusters", *dropped)
	}
}

func TestWarmPolicyFromEnv(t *testing.T) {
	cases := []struct {
		cap, idle string
		wantCap   int
		wantIdle  time.Duration
	}{
		{"", "", DefaultWarmCap, DefaultIdleAfter},
		{"3", "10m", 3, 10 * time.Minute},
		{"0", "0", 0, 0},
		{"99", "", 50, DefaultIdleAfter}, // clamped
		{"abc", "soon", DefaultWarmCap, DefaultIdleAfter},
		{"-2", "-5m", DefaultWarmCap, DefaultIdleAfter},
	}
	for _, c := range cases {
		gotCap, gotIdle := ParseWarmPolicy(c.cap, c.idle)
		if gotCap != c.wantCap || gotIdle != c.wantIdle {
			t.Errorf("ParseWarmPolicy(%q,%q) = %d,%v want %d,%v", c.cap, c.idle, gotCap, gotIdle, c.wantCap, c.wantIdle)
		}
	}
}
