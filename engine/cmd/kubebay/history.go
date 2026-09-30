package main

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/history"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/waste"
)

// setupHistory opens the local usage history (backlog #36) under the user
// config dir and feeds it from the sampler for clusters the user connected
// to. It never falls back to another directory: without a usable store the
// engine simply runs without history, and says why in /api/history/status.
// In-cluster deployments never record: a store that keeps recording while
// no laptop is open is the Enterprise line (#6/#15).
func setupHistory(log *slog.Logger, mgr *clusters.Manager, settings *httpapi.SettingsManager, sampler *waste.Sampler, inCluster bool, ctx context.Context) (*httpapi.HistoryAPI, func()) {
	api := &httpapi.HistoryAPI{Settings: settings}
	if inCluster {
		api.Unavailable = "usage history is not recorded for in-cluster deployments"
		return api, func() {}
	}
	base, err := os.UserConfigDir()
	if err != nil {
		api.Unavailable = "no user config directory: " + err.Error()
		log.Warn("history disabled", "err", err)
		return api, func() {}
	}
	st, err := history.Open(filepath.Join(base, "kubebay", "history"), history.Options{})
	if err != nil {
		api.Unavailable = err.Error()
		log.Warn("history disabled", "err", err)
		return api, func() {}
	}
	if st.ReadOnly() {
		log.Warn("history: another Kubebay engine is recording; this one only reads", "dir", st.Dir())
	}
	rec := history.NewRecorder(st)
	api.Recorder = rec
	metaFor := func(id string) history.Meta {
		for _, c := range mgr.List() {
			if c.ID == id {
				return history.Meta{ClusterID: id, Context: c.Context, Server: c.Server}
			}
		}
		return history.Meta{ClusterID: id}
	}
	sampler.SetRecorder(settings.HistoryEnabled, httpapi.HistoryUsageRecorder(rec, metaFor, log))
	go func() {
		_ = st.Prune(time.Now())
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := st.Prune(time.Now()); err != nil && err != history.ErrReadOnly {
					log.Warn("history prune failed", "err", err)
				}
			}
		}
	}()
	return api, func() { _ = st.Close() }
}
