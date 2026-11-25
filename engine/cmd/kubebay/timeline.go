package main

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/timeline"
)

// setupTimeline starts the desktop change timeline (backlog 82): one SQLite
// file under the user config dir, fed passively by the informer pools of the
// engine's own identity. A shared engine (in a cluster, or with OIDC or an
// auth proxy) never opens it and never attaches an observer; the handlers
// then answer 403 with the reason. A store that cannot be opened leaves the
// engine running with the timeline off and the error in /api/timeline/status.
func setupTimeline(log *slog.Logger, mgr *clusters.Manager, settings *httpapi.SettingsManager, reg *informers.PoolRegistry, blocked string, ctx context.Context) (*httpapi.TimelineAPI, func()) {
	days := 0
	dir := ""
	if blocked == "" {
		days = settings.TimelineRetentionDays()
		if base, err := os.UserConfigDir(); err == nil {
			dir = filepath.Join(base, "kubebay", "timeline")
		} else {
			log.Warn("timeline disabled", "err", err)
			days = 0
		}
	}
	m := timeline.NewManager(timeline.ManagerOptions{
		Dir: dir, RetentionDays: days, Log: log,
		Open: func(path string) (timeline.Store, error) { return timeline.OpenSQLite(path, timeline.SQLiteOptions{}) },
	})
	api := &httpapi.TimelineAPI{Manager: m, Settings: settings, Shared: blocked, Known: func(id string) bool {
		for _, c := range mgr.List() {
			if c.ID == id {
				return true
			}
		}
		return false
	}}
	if blocked != "" {
		return api, func() {}
	}
	if err := m.Start(ctx); err != nil {
		log.Warn("timeline unavailable", "err", err)
	}
	reg.SetObserver(m)
	return api, m.Close
}
