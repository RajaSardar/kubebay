package clusters

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

// Bug report (Raja): "also not able to see helm release, it is never
// loading". Root cause: HelmEnv resolves the kubeconfig file for a cluster
// from entry.kubeconfigPath, which Load() sets to
// strings.Join(rules.Precedence, os.PathListSeparator). That field is the
// wrong one to read: clientcmd.ClientConfigLoadingRules keeps an *explicit*
// single-file path (ExplicitPath) separate from the multi-file search list
// (Precedence), and leaves Precedence empty whenever ExplicitPath is set --
// which is exactly the case here, since loadingRules() builds
// &clientcmd.ClientConfigLoadingRules{ExplicitPath: m.kubeconfig} whenever
// the engine was started with a specific --kubeconfig (or KUBEBAY_KUBECONFIG,
// this repo's documented, recommended way to point it at a dedicated kind
// kubeconfig rather than the default ~/.kube/config).
//
// So in that (the normal, recommended) configuration, every entry's
// kubeconfigPath is silently the empty string. actionCfg() in
// httpapi/helm.go only sets cf.KubeConfig when kubeconfigPaths != "", so
// with an empty path it leaves cf.KubeConfig nil and genericclioptions falls
// back to discovering a kubeconfig the normal way: $KUBECONFIG or
// ~/.kube/config. If that ambient file doesn't have a context of the same
// name (almost certain for a dedicated kind kubeconfig, since CLAUDE.md
// explicitly tells contributors never to touch the default ~/.kube/config),
// every single Helm action.Configuration.Init call fails to resolve the
// intended cluster -- Helm releases can never load, while every other
// resource list keeps working because it reads the already-resolved
// *rest.Config from the entry directly and never re-parses a kubeconfig
// path at all.
func TestHelmEnvResolvesExplicitKubeconfigPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "kind-test.kubeconfig")
	kubeconfig := `apiVersion: v1
kind: Config
clusters:
- name: kind-test
  cluster:
    server: https://127.0.0.1:6443
contexts:
- name: kind-test
  context:
    cluster: kind-test
current-context: kind-test
`
	if err := os.WriteFile(path, []byte(kubeconfig), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	m, err := NewManager(slog.New(slog.NewTextHandler(os.Stderr, nil)), path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	entries := func() []string {
		m.mu.RLock()
		defer m.mu.RUnlock()
		ids := make([]string, 0, len(m.entries))
		for id := range m.entries {
			ids = append(ids, id)
		}
		return ids
	}()
	if len(entries) != 1 {
		t.Fatalf("entries = %v, want exactly one cluster loaded from %s", entries, path)
	}
	id := entries[0]

	ctxName, kubeconfigPath, err := m.HelmEnv(id)
	if err != nil {
		t.Fatalf("HelmEnv(%q): %v", id, err)
	}
	if ctxName != "kind-test" {
		t.Errorf("ctxName = %q, want %q", ctxName, "kind-test")
	}
	if kubeconfigPath == "" {
		t.Fatalf(
			"HelmEnv(%q) returned an empty kubeconfig path for a cluster loaded from an explicit "+
				"--kubeconfig file (%s) -- actionCfg() will now leave cf.KubeConfig nil and helm will "+
				"silently fall back to the ambient $KUBECONFIG / ~/.kube/config instead, which almost "+
				"certainly does not have a %q context: this is why Helm releases never load",
			id, path, ctxName,
		)
	}
	if kubeconfigPath != path {
		t.Errorf("kubeconfigPath = %q, want the explicit kubeconfig path %q", kubeconfigPath, path)
	}
}

// Guards the other branch of HelmEnv: when the engine merges several
// kubeconfig files (the default, non-explicit-path search), it must still
// pick out the one file that actually owns the requested context, not just
// blindly return the whole merged search list.
func TestHelmEnvPicksOwningFileAmongSeveralKubeconfigs(t *testing.T) {
	dir := t.TempDir()
	other := filepath.Join(dir, "other.kubeconfig")
	mine := filepath.Join(dir, "mine.kubeconfig")
	if err := os.WriteFile(other, []byte(`apiVersion: v1
kind: Config
clusters:
- name: other-cluster
  cluster:
    server: https://127.0.0.1:6444
contexts:
- name: other-context
  context:
    cluster: other-cluster
current-context: other-context
`), 0o600); err != nil {
		t.Fatalf("write other kubeconfig: %v", err)
	}
	if err := os.WriteFile(mine, []byte(`apiVersion: v1
kind: Config
clusters:
- name: mine-cluster
  cluster:
    server: https://127.0.0.1:6445
contexts:
- name: mine-context
  context:
    cluster: mine-cluster
current-context: mine-context
`), 0o600); err != nil {
		t.Fatalf("write mine kubeconfig: %v", err)
	}

	joined := fmt.Sprintf("%s%c%s", other, os.PathListSeparator, mine)
	m := &Manager{
		log:     slog.New(slog.NewTextHandler(os.Stderr, nil)),
		entries: map[string]*entry{},
	}
	m.entries["mine-context"] = &entry{
		kubeconfigPath: joined,
		cluster:        &Cluster{ID: "mine-context", Context: "mine-context"},
	}

	ctxName, kubeconfigPath, err := m.HelmEnv("mine-context")
	if err != nil {
		t.Fatalf("HelmEnv: %v", err)
	}
	if ctxName != "mine-context" {
		t.Errorf("ctxName = %q, want %q", ctxName, "mine-context")
	}
	if kubeconfigPath != mine {
		t.Errorf("kubeconfigPath = %q, want the file that actually owns the context (%q), not the whole merged list", kubeconfigPath, mine)
	}
}
