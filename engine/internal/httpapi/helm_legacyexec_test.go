package httpapi

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// Helm loads the kubeconfig itself, so the in-memory v1alpha1 → v1beta1 exec
// upgrade the cluster manager does has to apply to it too, or the Helm page
// fails on a cluster every other page reaches.
func TestHelmAsksALegacyExecPluginForV1beta1(t *testing.T) {
	dir := t.TempDir()
	kc := filepath.Join(dir, "kubeconfig")
	cfg := `apiVersion: v1
kind: Config
clusters:
- name: c
  cluster: {server: "https://127.0.0.1:1"}
contexts:
- name: legacy
  context: {cluster: c, user: u}
users:
- name: u
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1alpha1
      command: aws
current-context: legacy
`
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	ac, err := NewHelm(mgr, nil).actionCfg("legacy", "default")
	if err != nil {
		t.Fatal(err)
	}
	rc, err := ac.RESTClientGetter.ToRESTConfig()
	if err != nil {
		t.Fatal(err)
	}
	if rc.ExecProvider == nil || rc.ExecProvider.APIVersion != "client.authentication.k8s.io/v1beta1" {
		t.Errorf("helm exec config = %+v, want v1beta1", rc.ExecProvider)
	}
}
