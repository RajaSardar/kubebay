package main

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/waste"
)

func historyDeps(t *testing.T) (*slog.Logger, *clusters.Manager, *httpapi.SettingsManager, *waste.Sampler) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	kc := filepath.Join(home, "kubeconfig")
	cfg := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://127.0.0.1:1\ncontexts:\n- name: dev\n  context: {cluster: c, user: u}\nusers:\n- name: u\n  user: {}\ncurrent-context: dev\n"
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	mgr, err := clusters.NewManager(log, kc)
	if err != nil {
		t.Fatal(err)
	}
	return log, mgr, httpapi.NewSettingsManager(mgr), waste.NewSampler(mgr, log)
}

// Internal security review: an engine with OIDC on, not in a cluster, used to
// record usage history under its own identity and serve it to every user.
func TestHistoryIsNotRecordedWithOIDCOutsideACluster(t *testing.T) {
	log, mgr, sm, sampler := historyDeps(t)
	api, closeFn := setupHistory(log, mgr, sm, sampler, httpapi.HistoryBlockReason(false, true), t.Context())
	defer closeFn()
	if api.Recorder != nil {
		t.Fatal("an OIDC engine records usage history under its own identity")
	}
	if api.Unavailable == "" || api.Shared == "" {
		t.Errorf("no reason given: %+v", api)
	}
}

func TestDesktopStillRecordsHistory(t *testing.T) {
	log, mgr, sm, sampler := historyDeps(t)
	api, closeFn := setupHistory(log, mgr, sm, sampler, httpapi.HistoryBlockReason(false, false), t.Context())
	defer closeFn()
	if api.Recorder == nil || api.Shared != "" {
		t.Fatalf("desktop history off: %q", api.Unavailable)
	}
}
