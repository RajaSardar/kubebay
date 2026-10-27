package clusters

import (
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
)

const namespacedKubeconfig = `apiVersion: v1
kind: Config
clusters:
- {name: c, cluster: {server: "https://127.0.0.1:1"}}
contexts:
- {name: dev, context: {cluster: c, user: u, namespace: shop}}
- {name: admin, context: {cluster: c, user: u}}
users:
- {name: u, user: {token: t}}
current-context: dev
`

// A context's namespace is where its user looks first: someone whose RBAC
// stops at a namespace can't list namespaces, so the picker starts there
// (ADR 0003).
func TestEachClusterCarriesItsContextNamespace(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kubeconfig")
	writeKubeconfig(t, path, namespacedKubeconfig)
	m, err := newManager(slog.New(slog.NewTextHandler(io.Discard, nil)), path, false)
	if err != nil {
		t.Fatal(err)
	}
	if ns := byID(m.List(), "dev").Namespace; ns != "shop" {
		t.Errorf("dev namespace = %q, want shop", ns)
	}
	admin := byID(m.List(), "admin")
	if admin.Namespace != "" {
		t.Errorf("admin namespace = %q, want none", admin.Namespace)
	}
	b, _ := json.Marshal(admin)
	if strings.Contains(string(b), `"namespace"`) {
		t.Errorf("a context without a namespace still sends one: %s", b)
	}

	var changed []string
	m.OnConfigChange(func(id string) { changed = append(changed, id) })
	writeKubeconfig(t, path, strings.Replace(namespacedKubeconfig, "namespace: shop", "namespace: payments", 1))
	if err := m.Load(); err != nil {
		t.Fatal(err)
	}
	if ns := byID(m.List(), "dev").Namespace; ns != "payments" {
		t.Errorf("after the edit dev namespace = %q, want payments", ns)
	}
	if len(changed) != 0 {
		t.Errorf("a namespace edit was reported as new credentials for %v", changed)
	}
}
