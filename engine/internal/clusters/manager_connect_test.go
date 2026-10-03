package clusters

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// Three reachable-looking contexts (nothing listens on 127.0.0.1:1, so a probe
// fails fast) and one whose cluster entry is missing, which cannot build a
// client and is listed as misconfigured.
const connectKubeconfig = `apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://127.0.0.1:1
contexts:
- name: zeta
  context: {cluster: c, user: u}
- name: alpha
  context: {cluster: c, user: u}
- name: mid
  context: {cluster: c, user: u}
- name: broken
  context: {cluster: missing, user: u}
users:
- name: u
  user: {token: t}
current-context: alpha
`

func testManager(t *testing.T) *Manager {
	t.Helper()
	path := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(path, []byte(connectKubeconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := newManager(slog.New(slog.NewTextHandler(io.Discard, nil)), path, false)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func ids(cs []Cluster) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.ID
	}
	return out
}

func byID(cs []Cluster, id string) Cluster {
	for _, c := range cs {
		if c.ID == id {
			return c
		}
	}
	return Cluster{}
}

func TestListIsSortedAndStable(t *testing.T) {
	m := testManager(t)
	want := []string{"alpha", "broken", "mid", "zeta"}
	for i := 0; i < 5; i++ {
		if got := ids(m.List()); !equal(got, want) {
			t.Fatalf("order = %v, want %v (map order leaked)", got, want)
		}
		if err := m.Load(); err != nil {
			t.Fatal(err)
		}
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestNewClustersAreCheckingUntilProbed(t *testing.T) {
	m := testManager(t)
	cs := m.List()
	if s := byID(cs, "alpha").Status; s != StatusChecking {
		t.Errorf("alpha before any probe = %q, want %q (not a false 'unreachable')", s, StatusChecking)
	}
	if s := byID(cs, "broken").Status; s != StatusMisconfigured {
		t.Errorf("broken = %q, want misconfigured", s)
	}
}

func TestReloadKeepsWhatTheLastProbeFound(t *testing.T) {
	m := testManager(t)
	m.probe("alpha")
	before := byID(m.List(), "alpha")
	if before.Status != StatusUnreachable || before.CheckedAt == nil {
		t.Fatalf("after probe: %+v", before)
	}
	if err := m.Load(); err != nil {
		t.Fatal(err)
	}
	after := byID(m.List(), "alpha")
	if after.Status != StatusUnreachable || after.CheckedAt == nil || !after.CheckedAt.Equal(*before.CheckedAt) {
		t.Errorf("a kubeconfig reload reset the probe result: %+v", after)
	}
}

func TestProbeIsRaceFreeWithList(t *testing.T) {
	m := testManager(t)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); m.probe("mid") }()
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				_ = m.List()
			}
		}()
	}
	wg.Wait()
	if c := byID(m.List(), "mid"); c.Error == "" || c.CheckedAt == nil {
		t.Errorf("probe result not recorded: %+v", c)
	}
}

func TestConnectAndDisconnect(t *testing.T) {
	m := testManager(t)
	var torn []string
	m.OnDisconnect(func(id string) { torn = append(torn, id) })

	if err := m.Connect("alpha"); err != nil {
		t.Fatal(err)
	}
	if !m.IsConnected("alpha") || !byID(m.List(), "alpha").Connected {
		t.Fatal("alpha should be connected")
	}
	if byID(m.List(), "mid").Connected {
		t.Fatal("mid was never connected")
	}
	if err := m.Connect("broken"); err == nil {
		t.Error("a misconfigured context cannot be connected")
	}
	if err := m.Connect("nope"); err == nil {
		t.Error("an unknown id cannot be connected")
	}

	if err := m.Disconnect("alpha"); err != nil {
		t.Fatal(err)
	}
	if m.IsConnected("alpha") || byID(m.List(), "alpha").Connected {
		t.Error("alpha should be disconnected")
	}
	if !equal(torn, []string{"alpha"}) {
		t.Errorf("disconnect hooks ran for %v, want [alpha]", torn)
	}
	if err := m.Disconnect("nope"); err == nil {
		t.Error("an unknown id cannot be disconnected")
	}
}

func TestConnectedSurvivesReloadButNotRemoval(t *testing.T) {
	m := testManager(t)
	_ = m.Connect("alpha")
	if err := m.Load(); err != nil {
		t.Fatal(err)
	}
	if !m.IsConnected("alpha") {
		t.Error("a reload must not drop a connection")
	}
}

// "connected" on the wire meant reachable, which read as the user's session
// on the clusters page. The probe's answer is now called what it is.
func TestAProbedClusterIsReachableNotConnected(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"major":"1","minor":"31","gitVersion":"v1.31.0"}`))
	}))
	defer api.Close()
	path := filepath.Join(t.TempDir(), "kubeconfig")
	kc := strings.Replace(connectKubeconfig, "https://127.0.0.1:1", api.URL, 1)
	if err := os.WriteFile(path, []byte(kc), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := newManager(slog.New(slog.NewTextHandler(io.Discard, nil)), path, false)
	if err != nil {
		t.Fatal(err)
	}
	m.probe("alpha")
	c := byID(m.List(), "alpha")
	if c.Status != StatusReachable || c.Version != "v1.31.0" {
		t.Fatalf("after a good probe: %+v", c)
	}
	b, _ := json.Marshal(c)
	if !strings.Contains(string(b), `"status":"reachable"`) || !strings.Contains(string(b), `"connected":false`) {
		t.Errorf("wire form = %s: reachability and the session are separate fields", b)
	}
}
