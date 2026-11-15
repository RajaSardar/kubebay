package httpapi

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// A drain that can't build its client stops there, with that error, before
// it cordons anything. It went on to cordon the node with a client it had
// failed to make, and reported the cordon's error instead.
func TestDrainStopsWhenItCannotBuildAClient(t *testing.T) {
	notPEM := base64.StdEncoding.EncodeToString([]byte("not a certificate"))
	kubeconfig := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://127.0.0.1:1\n" +
		"contexts:\n- name: dev\n  context: {cluster: c, user: u}\n" +
		"users:\n- name: u\n  user:\n    client-certificate-data: " + notPEM + "\n    client-key-data: " + notPEM + "\n" +
		"current-context: dev\n"
	kc := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(kc, []byte(kubeconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.RestConfigWithIdentity("dev", clusters.IdentityFromContext(context.Background())); err != nil {
		t.Fatalf("the kubeconfig should load; only building a client from it should fail: %v", err)
	}

	_, err = (&Actions{Clusters: mgr}).Drain(context.Background(), "dev", "node-1", true)
	if err == nil {
		t.Fatal("Drain succeeded with a client it couldn't build")
	}
	if strings.HasPrefix(err.Error(), "cordon") {
		t.Fatalf("Drain went on to cordon the node: %v", err)
	}
}
