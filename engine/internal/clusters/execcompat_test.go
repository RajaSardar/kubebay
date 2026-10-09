package clusters

import (
	"encoding/base64"
	"encoding/pem"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// A plugin that answers in whatever version client-go asks for, the way current
// aws, gke-gcloud-auth-plugin and kubelogin do through KUBERNETES_EXEC_INFO.
const echoingPlugin = `#!/bin/sh
v=$(printf '%s' "$KUBERNETES_EXEC_INFO" | sed -n 's/.*"apiVersion":"\([^"]*\)".*/\1/p')
printf '{"apiVersion":"%s","kind":"ExecCredential","status":{"token":"good"}}' "$v"
`

// A plugin old enough to always answer v1alpha1 (aws CLI before 1.24/2.7).
const v1alpha1OnlyPlugin = `#!/bin/sh
printf '{"apiVersion":"client.authentication.k8s.io/v1alpha1","kind":"ExecCredential","status":{"token":"good"}}'
`

func legacyExecManager(t *testing.T, plugin string) *Manager {
	t.Helper()
	// TLS, because clientcmd only applies a user's credentials to a TLS server.
	api := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"major":"1","minor":"31","gitVersion":"v1.31.0"}`))
	}))
	t.Cleanup(api.Close)
	dir := t.TempDir()
	pluginPath := filepath.Join(dir, "token-plugin")
	if err := os.WriteFile(pluginPath, []byte(plugin), 0o700); err != nil {
		t.Fatal(err)
	}
	kc := `apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: ` + api.URL + `
    certificate-authority-data: ` + base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: api.Certificate().Raw})) + `
contexts:
- name: legacy
  context: {cluster: c, user: u}
users:
- name: u
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1alpha1
      command: ` + pluginPath + `
current-context: legacy
`
	path := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(path, []byte(kc), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := newManager(slog.New(slog.NewTextHandler(io.Discard, nil)), path, false)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// client-go dropped client.authentication.k8s.io/v1alpha1 in v1.24, so a
// kubeconfig written by an old `aws eks update-kubeconfig` fails with
// `exec plugin: invalid apiVersion` even when the CLI on PATH has long since
// learned v1beta1. Asking the plugin for v1beta1 in memory fixes that case
// without touching the user's file.
func TestLegacyV1alpha1ExecConfigIsAskedForV1beta1(t *testing.T) {
	m := legacyExecManager(t, echoingPlugin)
	cfg, err := m.RestConfig("legacy")
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.ExecProvider.APIVersion; got != "client.authentication.k8s.io/v1beta1" {
		t.Errorf("exec apiVersion = %q, want v1beta1", got)
	}
	m.probe("legacy")
	if c := byID(m.List(), "legacy"); c.Status != StatusReachable {
		t.Fatalf("probe with an echoing plugin: %+v", c)
	}
}

// When the plugin itself is too old, client-go's own error says "configured to
// use v1beta1", which contradicts the user's file. Say what actually happened.
func TestAPluginStuckOnV1alpha1GetsANamedCause(t *testing.T) {
	m := legacyExecManager(t, v1alpha1OnlyPlugin)
	m.probe("legacy")
	c := byID(m.List(), "legacy")
	if c.Status != StatusUnreachable {
		t.Fatalf("status = %s, want unreachable", c.Status)
	}
	for _, want := range []string{"v1alpha1", "token-plugin", "update"} {
		if !strings.Contains(c.Error, want) {
			t.Errorf("error %q should mention %q", c.Error, want)
		}
	}
}

func TestUpgradeLegacyExecLeavesEverythingElseAlone(t *testing.T) {
	for _, v := range []string{"client.authentication.k8s.io/v1beta1", "client.authentication.k8s.io/v1"} {
		cfg := &rest.Config{ExecProvider: &clientcmdapi.ExecConfig{APIVersion: v}}
		if UpgradeLegacyExec(cfg) || cfg.ExecProvider.APIVersion != v {
			t.Errorf("%s was rewritten to %s", v, cfg.ExecProvider.APIVersion)
		}
	}
	if UpgradeLegacyExec(&rest.Config{BearerToken: "t"}) {
		t.Error("a token config has no exec stanza to upgrade")
	}
	if UpgradeLegacyExec(nil) {
		t.Error("nil config")
	}
}
