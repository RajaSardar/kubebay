package httpapi

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

const reloadKubeconfig = "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://127.0.0.1:1\ncontexts:\n- name: dev\n  context: {cluster: c, user: u}\nusers:\n- name: u\n  user: {token: old}\ncurrent-context: dev\n"

func TestNewCredentialsRetireTheClustersPools(t *testing.T) {
	kc := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(kc, []byte(reloadKubeconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	reg := informers.NewPoolRegistry(mgr)
	TeardownOnDisconnect(mgr, reg, nil)
	pool, err := reg.For(context.Background(), "dev")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(kc, []byte(strings.Replace(reloadKubeconfig, "token: old", "token: new", 1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Load(); err != nil {
		t.Fatal(err)
	}
	if !pool.Closed() {
		t.Fatal("a pool built with the old token must be retired after the kubeconfig changed")
	}
}
