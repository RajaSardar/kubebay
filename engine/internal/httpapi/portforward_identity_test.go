package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// In OIDC mode a port-forward must impersonate the logged-in user, like
// every other cluster call, not tunnel with the engine's own credentials.
func TestPortForwardImpersonatesTheRequestIdentity(t *testing.T) {
	seen := make(chan string, 8)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The manager's own /version health probe runs as the engine; only the tunnel matters.
		if strings.HasSuffix(r.URL.Path, "/portforward") {
			seen <- r.Header.Get("Impersonate-User")
		}
		http.Error(w, "no", http.StatusForbidden)
	}))
	defer api.Close()

	kc := filepath.Join(t.TempDir(), "kubeconfig")
	cfg := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: " + api.URL + "\ncontexts:\n- name: dev\n  context: {cluster: c, user: u}\nusers:\n- name: u\n  user: {token: t}\ncurrent-context: dev\n"
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	pf := NewPFManager(mgr)
	ctx := clusters.WithIdentity(context.Background(), &clusters.Identity{Name: "alice", Groups: []string{"dev"}})
	go func() { _, _ = pf.Start(ctx, "dev", "default", "web", 80, 0) }()

	select {
	case user := <-seen:
		if user != "alice" {
			t.Errorf("port-forward reached the API server as %q, want it to impersonate alice", user)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("port-forward never reached the API server")
	}
}
