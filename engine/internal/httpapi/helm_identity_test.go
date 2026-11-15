package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	rcommon "helm.sh/helm/v4/pkg/release/common"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// ADR 0004 S2: Helm acts as the person signed in, like every other request
// (in-cluster mode impersonates them), and it needs no kubeconfig file, which
// in-cluster mode doesn't have.

const tokenKubeconfig = `apiVersion: v1
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

func tokenManager(t *testing.T) (*clusters.Manager, string) {
	t.Helper()
	kc := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(kc, []byte(tokenKubeconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	return mgr, kc
}

func TestHelmActsAsTheSignedInIdentity(t *testing.T) {
	mgr, _ := tokenManager(t)
	h := NewHelm(mgr, nil)

	ctx := clusters.WithIdentity(context.Background(), &clusters.Identity{Name: "alice", Groups: []string{"dev"}})
	ac, err := h.actionCfg(ctx, "dev", "shop")
	if err != nil {
		t.Fatal(err)
	}
	rc, err := ac.RESTClientGetter.ToRESTConfig()
	if err != nil {
		t.Fatal(err)
	}
	if rc.Impersonate.UserName != "alice" || !slices.Equal(rc.Impersonate.Groups, []string{"dev"}) {
		t.Errorf("helm impersonates %+v, want alice in dev", rc.Impersonate)
	}

	ac, err = h.actionCfg(context.Background(), "dev", "shop")
	if err != nil {
		t.Fatal(err)
	}
	rc, err = ac.RESTClientGetter.ToRESTConfig()
	if err != nil {
		t.Fatal(err)
	}
	if rc.Impersonate.UserName != "" || rc.BearerToken != "t" {
		t.Errorf("with nobody signed in helm should use the kubeconfig's user: impersonate %+v, token %q", rc.Impersonate, rc.BearerToken)
	}
}

func TestHelmNeedsNoKubeconfigFile(t *testing.T) {
	mgr, kc := tokenManager(t)
	if err := os.Remove(kc); err != nil {
		t.Fatal(err)
	}
	ac, err := NewHelm(mgr, nil).actionCfg(context.Background(), "dev", "shop")
	if err != nil {
		t.Fatal(err)
	}
	rc, err := ac.RESTClientGetter.ToRESTConfig()
	if err != nil {
		t.Fatalf("helm needs the kubeconfig file: %v", err)
	}
	if rc.Host != "https://127.0.0.1:1" {
		t.Errorf("helm talks to %q", rc.Host)
	}
}

func TestHelmRollbackAndUninstallAreAudited(t *testing.T) {
	// os.UserConfigDir reads XDG_CONFIG_HOME on Linux but $HOME/Library/Application Support on macOS;
	// redirect both so the audit log never lands in the real one.
	cfg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", cfg)
	t.Setenv("HOME", cfg)
	lg, err := audit.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lg.Close() })
	h := memoryHelm(t, webRelease(1, rcommon.StatusSuperseded), webRelease(2, rcommon.StatusDeployed))
	h.Audit = lg

	post := func(handler http.HandlerFunc, body string) {
		t.Helper()
		rec := httptest.NewRecorder()
		handler(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)))
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body)
		}
	}
	post(h.HandleRollback, `{"cluster":"c","ns":"shop","name":"web","revision":1}`)
	post(h.HandleUninstall, `{"cluster":"c","ns":"shop","name":"web"}`)

	got, err := lg.Tail(10)
	if err != nil {
		t.Fatal(err)
	}
	want := []audit.Entry{
		{Action: "helm-rollback", Cluster: "c", Namespace: "shop", Resource: "web", Detail: "revision=1"},
		{Action: "helm-uninstall", Cluster: "c", Namespace: "shop", Resource: "web"},
	}
	if len(got) != len(want) {
		t.Fatalf("audit = %+v, want %d entries", got, len(want))
	}
	for i := range want {
		g := got[i]
		if g.Action != want[i].Action || g.Cluster != want[i].Cluster || g.Namespace != want[i].Namespace || g.Resource != want[i].Resource || g.Detail != want[i].Detail {
			t.Errorf("audit[%d] = %+v, want %+v", i, g, want[i])
		}
	}
}
