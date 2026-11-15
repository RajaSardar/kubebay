package clusters

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func writeKubeconfig(t *testing.T, path, body string) {
	t.Helper()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	// Atomic replace, the way editors and `kubectl config` save.
	if err := os.Rename(tmp, path); err != nil {
		t.Fatal(err)
	}
}

func TestCollidingContextNamesGetDistinctStableIDs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kubeconfig")
	writeKubeconfig(t, path, `apiVersion: v1
kind: Config
clusters:
- {name: c, cluster: {server: "https://127.0.0.1:1"}}
contexts:
- {name: "team/dev", context: {cluster: c, user: u}}
- {name: "team:dev", context: {cluster: c, user: u}}
- {name: "team-dev", context: {cluster: c, user: u}}
users:
- {name: u, user: {token: t}}
current-context: team-dev
`)
	m, err := newManager(slog.New(slog.NewTextHandler(io.Discard, nil)), path, false)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		got := map[string]string{}
		for _, c := range m.List() {
			if prev, dup := got[c.ID]; dup {
				t.Fatalf("contexts %q and %q share the id %q", prev, c.Context, c.ID)
			}
			got[c.ID] = c.Context
		}
		want := map[string]string{"team-dev": "team-dev", "team-dev-2": "team/dev", "team-dev-3": "team:dev"}
		for id, ctx := range want {
			if got[id] != ctx {
				t.Errorf("id %q -> %q, want %q (all: %v)", id, got[id], ctx, got)
			}
			if name, _ := m.ContextName(id); name != ctx {
				t.Errorf("ContextName(%q) = %q, want %q", id, name, ctx)
			}
		}
		if err := m.Load(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestReloadReportsContextsWhoseCredentialsChanged(t *testing.T) {
	m := testManager(t)
	var changed []string
	m.OnConfigChange(func(id string) { changed = append(changed, id) })

	if err := m.Load(); err != nil {
		t.Fatal(err)
	}
	if len(changed) != 0 {
		t.Fatalf("an unchanged reload reported %v", changed)
	}

	m.probe("alpha")
	path := m.ActiveKubeconfigs()[0]
	writeKubeconfig(t, path, strings.Replace(connectKubeconfig, "token: t", "token: rotated", 1))
	if err := m.Load(); err != nil {
		t.Fatal(err)
	}
	sort.Strings(changed)
	if !equal(changed, []string{"alpha", "mid", "zeta"}) {
		t.Errorf("rotated token reported for %v, want every context using it (and not the misconfigured one)", changed)
	}
	if st := byID(m.List(), "alpha").Status; st != StatusChecking {
		t.Errorf("after new credentials alpha = %q, want %q: the old probe judged the old credentials", st, StatusChecking)
	}
}

func TestWatcherReloadsAnExplicitKubeconfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kubeconfig")
	writeKubeconfig(t, path, connectKubeconfig)
	m, err := NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), path)
	if err != nil {
		t.Fatal(err)
	}
	writeKubeconfig(t, path, strings.Replace(connectKubeconfig, "- name: mid", "- name: added\n  context: {cluster: c, user: u}\n- name: mid", 1))
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if byID(m.List(), "added").ID != "" {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("an edit to the --kubeconfig file was never picked up")
}
