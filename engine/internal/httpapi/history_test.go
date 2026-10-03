package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"k8s.io/client-go/kubernetes/fake"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/history"
	"github.com/RajaSardar/kubebay/engine/internal/waste"
)

// settingsWithManager isolates settings in a temp HOME and gives HandleSave a
// real cluster manager over a throwaway kubeconfig (never ~/.kube/config).
func settingsWithManager(t *testing.T) *SettingsManager {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	kc := filepath.Join(home, "kubeconfig")
	cfg := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://127.0.0.1:1\ncontexts:\n- name: kind-dev\n  context:\n    cluster: c\n    user: u\nusers:\n- name: u\n  user: {}\ncurrent-context: kind-dev\n"
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KUBEBAY_KUBECONFIG", kc)
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	return NewSettingsManager(mgr)
}

func save(t *testing.T, sm *SettingsManager, body string) {
	t.Helper()
	rec := httptest.NewRecorder()
	sm.HandleSave(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("save %s: %d %s", body, rec.Code, rec.Body)
	}
}

func TestHandleSave_KeepsHistoryClustersWhenOmitted(t *testing.T) {
	sm := settingsWithManager(t)
	if _, err := sm.EnrollHistory("kind-dev"); err != nil {
		t.Fatal(err)
	}
	save(t, sm, `{"prometheusUrl":"http://prom:9090"}`)
	set, _ := sm.Load()
	if !set.HistoryClusters["kind-dev"] || set.PrometheusURL != "http://prom:9090" {
		t.Fatalf("a save without historyClusters must keep them: %+v", set)
	}
	save(t, sm, `{"historyClusters":{"kind-dev":false}}`)
	set, _ = sm.Load()
	if set.HistoryClusters["kind-dev"] {
		t.Fatal("an explicit historyClusters value must be saved")
	}
}

func TestEnrollHistory_DoesNotOverrideExplicitStop(t *testing.T) {
	sm := settingsWithManager(t)
	if err := sm.SetHistoryRecording("prod", false); err != nil {
		t.Fatal(err)
	}
	on, _ := sm.EnrollHistory("prod")
	if on || sm.HistoryEnabled("prod") {
		t.Fatal("connecting again must not override an explicit stop")
	}
	on, _ = sm.EnrollHistory("kind-dev")
	if !on || !sm.HistoryEnabled("kind-dev") {
		t.Fatal("first connect enrolls")
	}
	if sm.HistoryEnabled("never-connected") {
		t.Fatal("clusters never connected to are not recorded")
	}
}

func TestSettings_ConcurrentEnrollAndSaveLoseNothing(t *testing.T) {
	sm := settingsWithManager(t)
	var wg sync.WaitGroup
	for i := 0; i < 15; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			_, _ = sm.EnrollHistory(fmt.Sprintf("c%d", i))
		}(i)
		go func() {
			defer wg.Done()
			rec := httptest.NewRecorder()
			sm.HandleSave(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"prometheusUrls":{"kind-dev":"http://p:9090"}}`)))
		}()
	}
	wg.Wait()
	set, _ := sm.Load()
	for i := 0; i < 15; i++ {
		if !set.HistoryClusters[fmt.Sprintf("c%d", i)] {
			t.Fatalf("enrollment c%d lost to a concurrent save: %v", i, set.HistoryClusters)
		}
	}
	if set.PrometheusURLs["kind-dev"] != "http://p:9090" {
		t.Fatal("save lost")
	}
}

type historyFixture struct {
	api   *HistoryAPI
	store *history.Store
	sm    *SettingsManager
}

func newHistoryFixture(t *testing.T) historyFixture {
	t.Helper()
	sm := settingsWithManager(t)
	st, err := history.Open(filepath.Join(t.TempDir(), "history"), history.Options{Location: time.UTC})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return historyFixture{api: &HistoryAPI{Recorder: history.NewRecorder(st), Settings: sm}, store: st, sm: sm}
}

func do(h http.HandlerFunc, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestHistoryHandlers_RequireCluster(t *testing.T) {
	f := newHistoryFixture(t)
	for name, h := range map[string]http.HandlerFunc{
		"enroll": f.api.HandleEnroll, "recording": f.api.HandleRecording, "erase": f.api.HandleErase,
		"status": f.api.HandleStatus, "series": f.api.HandleSeries,
	} {
		if rec := do(h, http.MethodGet, "/x"); rec.Code != http.StatusBadRequest {
			t.Errorf("%s without cluster: %d", name, rec.Code)
		}
	}
}

func TestHistoryStatus_ReportsRecordingPathRetention(t *testing.T) {
	f := newHistoryFixture(t)
	var st struct {
		Available     bool   `json:"available"`
		Recording     bool   `json:"recording"`
		Path          string `json:"path"`
		RetentionDays int    `json:"retentionDays"`
	}
	_ = json.Unmarshal(do(f.api.HandleStatus, http.MethodGet, "/x?cluster=kind-dev").Body.Bytes(), &st)
	if !st.Available || st.Recording || st.Path != f.store.Dir() || st.RetentionDays != 35 {
		t.Fatalf("before enrolling: %+v", st)
	}
	if rec := do(f.api.HandleEnroll, http.MethodPost, "/x?cluster=kind-dev"); rec.Code != http.StatusOK {
		t.Fatalf("enroll: %d", rec.Code)
	}
	_ = json.Unmarshal(do(f.api.HandleStatus, http.MethodGet, "/x?cluster=kind-dev").Body.Bytes(), &st)
	if !st.Recording {
		t.Fatal("enrolled cluster reports recording")
	}
	do(f.api.HandleRecording, http.MethodPut, "/x?cluster=kind-dev&on=false")
	do(f.api.HandleEnroll, http.MethodPost, "/x?cluster=kind-dev")
	_ = json.Unmarshal(do(f.api.HandleStatus, http.MethodGet, "/x?cluster=kind-dev").Body.Bytes(), &st)
	if st.Recording {
		t.Fatal("stop is sticky across reconnects")
	}
}

func TestHistoryUsageRecorder_RecordsThenEraseAndSeries(t *testing.T) {
	f := newHistoryFixture(t)
	rec := HistoryUsageRecorder(f.api.Recorder, func(id string) history.Meta { return history.Meta{ClusterID: id, Context: id} }, nil)
	now := time.Now()
	rec(context.Background(), "kind-dev", fake.NewSimpleClientset(), now, []waste.NsUsage{
		{Ns: "", ReqCPUMillis: 100},
		{Ns: "shop", ReqCPUMillis: 100},
	})
	from := now.Add(-time.Hour).UTC().Format(time.RFC3339)
	to := now.Add(time.Hour).UTC().Format(time.RFC3339)
	res := do(f.api.HandleSeries, http.MethodGet, "/x?cluster=kind-dev&ns=shop&from="+from+"&to="+to)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"cpuMean":null`) || !strings.Contains(res.Body.String(), `"reqCpuMillis":100`) {
		t.Fatalf("series: %d %s", res.Code, res.Body)
	}
	if res := do(f.api.HandleErase, http.MethodDelete, "/x?cluster=kind-dev"); res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"erased":1`) {
		t.Fatalf("erase: %d %s", res.Code, res.Body)
	}
	if res := do(f.api.HandleSeries, http.MethodGet, "/x?cluster=kind-dev"); res.Code != http.StatusNotFound {
		t.Fatalf("series after erase: %d", res.Code)
	}
}

func TestHistoryAPI_UnavailableStoreStillTakesConsent(t *testing.T) {
	sm := settingsWithManager(t)
	api := &HistoryAPI{Settings: sm, Unavailable: "history dir not writable"}
	var st struct {
		Available bool   `json:"available"`
		Reason    string `json:"reason"`
	}
	_ = json.Unmarshal(do(api.HandleStatus, http.MethodGet, "/x?cluster=kind-dev").Body.Bytes(), &st)
	if st.Available || st.Reason == "" {
		t.Fatalf("status: %+v", st)
	}
	if rec := do(api.HandleEnroll, http.MethodPost, "/x?cluster=kind-dev"); rec.Code != http.StatusOK || !sm.HistoryEnabled("kind-dev") {
		t.Fatalf("enroll without a store: %d", rec.Code)
	}
	if rec := do(api.HandleSeries, http.MethodGet, "/x?cluster=kind-dev"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("series without a store: %d", rec.Code)
	}
}

// The drawer's 7-day chip asks how many recorded hours a workload was broken in.
func TestHistoryHealth_BrokenOverRecordedHours(t *testing.T) {
	f := newHistoryFixture(t)
	rec := HistoryUsageRecorder(f.api.Recorder, func(id string) history.Meta { return history.Meta{ClusterID: id, Context: id} }, nil)
	now := time.Now()
	rec(context.Background(), "kind-dev", fake.NewSimpleClientset(), now, []waste.NsUsage{
		{Ns: "", ReqCPUMillis: 100, Broken: []string{"shop/Deployment/api"}},
		{Ns: "shop", ReqCPUMillis: 100},
	})
	var h history.WorkloadHealth
	res := do(f.api.HandleHealth, http.MethodGet, "/x?cluster=kind-dev&ns=shop&kind=Deployment&name=api")
	if res.Code != http.StatusOK {
		t.Fatalf("health: %d %s", res.Code, res.Body)
	}
	_ = json.Unmarshal(res.Body.Bytes(), &h)
	if h != (history.WorkloadHealth{RecordedHours: 1, BrokenHours: 1, RecordedDays: 1, BrokenDays: 1}) {
		t.Fatalf("api: %+v", h)
	}
	_ = json.Unmarshal(do(f.api.HandleHealth, http.MethodGet, "/x?cluster=kind-dev&ns=shop&kind=Deployment&name=web").Body.Bytes(), &h)
	if h.RecordedHours != 1 || h.BrokenHours != 0 {
		t.Fatalf("web, clean: %+v", h)
	}
	// Hours before the workload existed don't count for it.
	since := now.Add(2 * time.Hour).UTC().Format(time.RFC3339)
	_ = json.Unmarshal(do(f.api.HandleHealth, http.MethodGet, "/x?cluster=kind-dev&ns=shop&kind=Deployment&name=api&since="+since).Body.Bytes(), &h)
	if h.RecordedHours != 0 {
		t.Fatalf("created later: %+v", h)
	}
	if res := do(f.api.HandleHealth, http.MethodGet, "/x?cluster=kind-dev&ns=shop&kind=Deployment"); res.Code != http.StatusBadRequest {
		t.Fatalf("missing name: %d", res.Code)
	}
	if res := do(f.api.HandleHealth, http.MethodGet, "/x?cluster=other&ns=shop&kind=Deployment&name=api"); res.Code != http.StatusNotFound {
		t.Fatalf("never recorded: %d", res.Code)
	}
}
