package httpapi

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	genericclioptions "k8s.io/cli-runtime/pkg/genericclioptions"

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

// Helm's Kubernetes client creates a chart's namespaceless objects in its own
// namespace. It has to be the release's, as with `helm install -n`, or they
// land in the kubeconfig context's namespace ("default").
func TestHelmActionConfigTargetsTheReleaseNamespace(t *testing.T) {
	dir := t.TempDir()
	kc := filepath.Join(dir, "kubeconfig")
	cfg := `apiVersion: v1
kind: Config
clusters:
- name: c
  cluster: {server: "https://127.0.0.1:1"}
contexts:
- name: dev
  context: {cluster: c, user: u, namespace: default}
users:
- name: u
  user: {token: t}
current-context: dev
`
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	ac, err := NewHelm(mgr, nil).actionCfg("dev", "team-a")
	if err != nil {
		t.Fatal(err)
	}
	getter, ok := ac.RESTClientGetter.(genericclioptions.RESTClientGetter)
	if !ok {
		t.Fatalf("helm's client getter is a %T", ac.RESTClientGetter)
	}
	ns, _, err := getter.ToRawKubeConfigLoader().Namespace()
	if err != nil {
		t.Fatal(err)
	}
	if ns != "team-a" {
		t.Errorf("helm's client namespace = %q, want the release's (team-a)", ns)
	}
}
