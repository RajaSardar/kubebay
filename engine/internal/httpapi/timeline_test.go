package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/timeline"
)

func tlOpen(string) (timeline.Store, error) { return timeline.NewMemStore(), nil }

func newTimelineAPI(t *testing.T, days int) (*TimelineAPI, *audit.Logger) {
	t.Helper()
	sm := settingsWithManager(t)
	lg, err := audit.NewWithOptions(slog.New(slog.NewTextHandler(io.Discard, nil)), audit.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	m := timeline.NewManager(timeline.ManagerOptions{Dir: t.TempDir(), RetentionDays: days, Open: tlOpen})
	if err := m.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	api := &TimelineAPI{Manager: m, Settings: sm, Audit: lg, Known: func(c string) bool { return c == "kind-dev" }}
	return api, lg
}

func tlSeed(t *testing.T, api *TimelineAPI, cluster string, n int) {
	t.Helper()
	rows := make([]timeline.Change, n)
	for i := range rows {
		rows[i] = timeline.Change{Cluster: cluster, TS: time.Now().Add(-time.Duration(i) * time.Minute), Kind: "Deployment", Namespace: "ns", Name: "web", Op: timeline.OpUpdate, FieldManager: "argocd",
			Fields: []timeline.FieldChange{{Path: "spec.replicas", Kind: "changed"}}}
	}
	if err := api.Manager.Store().Append(rows); err != nil {
		t.Fatal(err)
	}
}

func tlGet(h http.HandlerFunc, url string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, url, nil))
	return rec
}

func TestTimelineChangesFilterPaginateAndShowGaps(t *testing.T) {
	api, _ := newTimelineAPI(t, 7)
	tlSeed(t, api, "kind-dev", 5)
	rec := tlGet(api.HandleChanges, "/api/timeline/changes?cluster=kind-dev&kind=Deployment&manager=argocd&limit=2")
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var out struct {
		Changes    []timeline.Change `json:"changes"`
		NextCursor string            `json:"nextCursor"`
		Coverage   []struct {
			Kind string         `json:"kind"`
			Gaps []timeline.Gap `json:"gaps"`
		} `json:"coverage"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Changes) != 2 || out.NextCursor == "" {
		t.Errorf("page: %d next %q", len(out.Changes), out.NextCursor)
	}
	if len(out.Coverage) != 1 || out.Coverage[0].Kind != "Deployment" || len(out.Coverage[0].Gaps) == 0 {
		t.Errorf("a kind that was never watched must show a not-recorded band: %+v", out.Coverage)
	}
	rec = tlGet(api.HandleChanges, "/api/timeline/changes?cluster=kind-dev&manager=nobody")
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Changes) != 0 {
		t.Error("manager filter ignored")
	}
}

func TestTimelineValidatesInput(t *testing.T) {
	api, _ := newTimelineAPI(t, 7)
	for url, want := range map[string]int{
		"/api/timeline/changes":                                     http.StatusBadRequest,
		"/api/timeline/changes?cluster=kind-dev&from=yesterday":     http.StatusBadRequest,
		"/api/timeline/changes?cluster=kind-dev&limit=abc":          http.StatusBadRequest,
		"/api/timeline/changes?cluster=kind-dev&limit=99999":        http.StatusOK, // clamped
		"/api/timeline/changes?cluster=" + strings.Repeat("a", 400): http.StatusForbidden,
		"/api/timeline/changes?cluster=other-cluster":               http.StatusForbidden, // never connected
		"/api/timeline/facets?cluster=other-cluster":                http.StatusForbidden,
	} {
		h := api.HandleChanges
		if strings.Contains(url, "facets") {
			h = api.HandleFacets
		}
		if rec := tlGet(h, url); rec.Code != want {
			t.Errorf("%s: %d want %d", url, rec.Code, want)
		}
	}
}

func TestTimelineOffAnswers409(t *testing.T) {
	api, _ := newTimelineAPI(t, 0)
	if rec := tlGet(api.HandleChanges, "/api/timeline/changes?cluster=kind-dev"); rec.Code != http.StatusConflict {
		t.Errorf("%d", rec.Code)
	}
	var st map[string]any
	rec := tlGet(api.HandleStatus, "/api/timeline/status")
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	if rec.Code != 200 || st["enabled"] != false || st["retentionDays"] != float64(0) {
		t.Errorf("%d %v", rec.Code, st)
	}
}

func TestTimelineBlockedOnSharedEnginesInEveryHandler(t *testing.T) {
	api, _ := newTimelineAPI(t, 7)
	api.Shared = TimelineBlockReason(false, true)
	if api.Shared == "" || !strings.Contains(api.Shared, "auth proxy") {
		t.Fatalf("reason: %q", api.Shared)
	}
	if TimelineBlockReason(true, false) == "" || TimelineBlockReason(false, false) != "" {
		t.Error("in-cluster must block, desktop must not")
	}
	del := httptest.NewRecorder()
	api.HandleClear(del, httptest.NewRequest(http.MethodDelete, "/api/timeline?cluster=kind-dev", nil))
	put := httptest.NewRecorder()
	api.HandleSettings(put, httptest.NewRequest(http.MethodPut, "/api/timeline/settings", strings.NewReader(`{"retentionDays":3}`)))
	for name, rec := range map[string]*httptest.ResponseRecorder{
		"changes":  tlGet(api.HandleChanges, "/api/timeline/changes?cluster=kind-dev"),
		"facets":   tlGet(api.HandleFacets, "/api/timeline/facets?cluster=kind-dev"),
		"status":   tlGet(api.HandleStatus, "/api/timeline/status"),
		"clear":    del,
		"settings": put,
	} {
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "auth proxy") {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	if api.Manager.Retention() != 7 {
		t.Error("a blocked caller changed the retention")
	}
}

func TestTimelineSettingsValidatePersistAndAudit(t *testing.T) {
	api, lg := newTimelineAPI(t, 7)
	put := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		api.HandleSettings(rec, signedIn(httptest.NewRequest(http.MethodPut, "/api/timeline/settings", strings.NewReader(body)), alice))
		return rec
	}
	for _, bad := range []string{`{"retentionDays":31}`, `{"retentionDays":-1}`, `{}`, `nope`} {
		if rec := put(bad); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	if rec := put(`{"retentionDays":14}`); rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if api.Manager.Retention() != 14 || api.Settings.TimelineRetentionDays() != 14 {
		t.Errorf("not applied or not stored: %d %d", api.Manager.Retention(), api.Settings.TimelineRetentionDays())
	}
	es, _ := lg.Tail(10)
	if len(es) != 1 || es[0].Action != "timeline-retention" || es[0].User != "alice" || !strings.Contains(es[0].Detail, "14") {
		t.Errorf("audit: %+v", es)
	}
}

func TestTimelineClearIsScopedAndAudited(t *testing.T) {
	api, lg := newTimelineAPI(t, 7)
	api.Known = func(string) bool { return true }
	tlSeed(t, api, "kind-dev", 3)
	tlSeed(t, api, "kind-other", 2)
	rec := httptest.NewRecorder()
	api.HandleClear(rec, signedIn(httptest.NewRequest(http.MethodDelete, "/api/timeline?cluster=kind-dev", nil), alice))
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if p, _ := api.Manager.Store().Query(timeline.Query{Cluster: "kind-dev"}); len(p.Changes) != 0 {
		t.Error("cluster not cleared")
	}
	if p, _ := api.Manager.Store().Query(timeline.Query{Cluster: "kind-other"}); len(p.Changes) != 2 {
		t.Error("another cluster's rows were cleared")
	}
	es, _ := lg.Tail(10)
	if len(es) != 1 || es[0].Action != "timeline-clear" || es[0].Cluster != "kind-dev" {
		t.Errorf("audit: %+v", es)
	}
	rec = httptest.NewRecorder()
	api.HandleClear(rec, httptest.NewRequest(http.MethodDelete, "/api/timeline", nil))
	if p, _ := api.Manager.Store().Query(timeline.Query{Cluster: "kind-other"}); len(p.Changes) != 0 {
		t.Error("clear-all left rows")
	}
}

func TestTimelineResponsesNeverCarryValuesOrSecrets(t *testing.T) {
	api, _ := newTimelineAPI(t, 7)
	api.Manager.Observe("kind-dev", timeline.Observed{Resource: "secrets", ObjKind: "Secret", Op: timeline.OpAdd,
		New: map[string]any{"kind": "Secret", "metadata": map[string]any{"name": "db", "namespace": "ns", "uid": "u", "resourceVersion": "1"}, "data": map[string]any{"pw": "aHVudGVyMg=="}}})
	_ = api.Manager.Flush()
	rec := tlGet(api.HandleChanges, "/api/timeline/changes?cluster=kind-dev")
	if strings.Contains(rec.Body.String(), "Secret") || strings.Contains(rec.Body.String(), "aHVudGVy") {
		t.Errorf("secret leaked: %s", rec.Body)
	}
}

func TestTimelineRetentionSurvivesASettingsSave(t *testing.T) {
	sm := settingsWithManager(t)
	if err := sm.SetTimelineRetentionDays(3); err != nil {
		t.Fatal(err)
	}
	save(t, sm, `{"prometheusUrl":""}`)
	if sm.TimelineRetentionDays() != 3 {
		t.Errorf("an unrelated settings save reset the retention to %d", sm.TimelineRetentionDays())
	}
	_ = os.Remove(filepath.Join(os.Getenv("HOME"), ".kubebay", "settings.json"))
	if sm.TimelineRetentionDays() != timeline.DefaultRetentionDays {
		t.Errorf("default = %d", sm.TimelineRetentionDays())
	}
}
