package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/timeline"
)

// The change timeline is one per-user file; a shared engine never opens it
// and never attaches an observer to its pools.
func TestTimelineIsNotKeptOnASharedEngine(t *testing.T) {
	log, mgr, sm, _ := historyDeps(t)
	reg := informers.NewPoolRegistry(mgr)
	api, closeFn := setupTimeline(log, mgr, sm, reg, httpapi.TimelineBlockReason(false, true), t.Context())
	defer closeFn()
	if api.Shared == "" {
		t.Error("no reason given")
	}
	if api.Manager.Store() != nil || api.Manager.Active() {
		t.Error("a shared engine opened the timeline")
	}
	base, _ := os.UserConfigDir()
	if _, err := os.Stat(filepath.Join(base, "kubebay", "timeline")); err == nil {
		t.Error("a timeline directory was created")
	}
}

func TestDesktopKeepsTheTimelineForSevenDaysByDefault(t *testing.T) {
	log, mgr, sm, _ := historyDeps(t)
	reg := informers.NewPoolRegistry(mgr)
	api, closeFn := setupTimeline(log, mgr, sm, reg, "", t.Context())
	defer closeFn()
	if api.Shared != "" || !api.Manager.Active() || api.Manager.Retention() != timeline.DefaultRetentionDays {
		t.Fatalf("%+v %+v", api, api.Manager.Status())
	}
	base, _ := os.UserConfigDir()
	fi, err := os.Stat(filepath.Join(base, "kubebay", "timeline", "timeline.db"))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm()&0o077 != 0 {
		t.Errorf("database is readable by others: %v", fi.Mode())
	}
}

func TestStoredRetentionOffKeepsTheTimelineOff(t *testing.T) {
	log, mgr, sm, _ := historyDeps(t)
	if err := sm.SetTimelineRetentionDays(0); err != nil {
		t.Fatal(err)
	}
	api, closeFn := setupTimeline(log, mgr, sm, informers.NewPoolRegistry(mgr), "", t.Context())
	defer closeFn()
	if api.Manager.Active() || api.Manager.Retention() != 0 {
		t.Error("opened although retention is off")
	}
}
