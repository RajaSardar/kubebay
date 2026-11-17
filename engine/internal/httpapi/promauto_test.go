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

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/history"
)

// fakeAPIServer stands in for a cluster's API server: it lists Services and
// fronts a Prometheus through the service proxy, recording what it was asked.
type fakeAPIServer struct {
	*httptest.Server
	mu          sync.Mutex
	listCalls   int
	proxyPaths  []string
	proxyUsers  []string
	listUsers   []string
	denyList    bool
	servicesRaw string
}

const monitoringServices = `{"kind":"ServiceList","apiVersion":"v1","items":[
 {"metadata":{"namespace":"monitoring","name":"prometheus-server","labels":{"app":"prometheus"}},"spec":{"clusterIP":"10.0.0.2","ports":[{"name":"http","port":80}]}},
 {"metadata":{"namespace":"monitoring","name":"alertmanager","labels":{"app":"alertmanager"}},"spec":{"clusterIP":"10.0.0.3","ports":[{"name":"http","port":9093}]}},
 {"metadata":{"namespace":"monitoring","name":"prometheus-operated"},"spec":{"clusterIP":"None","ports":[{"name":"web","port":9090}]}}
]}`

func newFakeAPIServer(t *testing.T) *fakeAPIServer {
	t.Helper()
	f := &fakeAPIServer{servicesRaw: monitoringServices}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case strings.Contains(r.URL.Path, "/proxy/"):
			f.proxyPaths = append(f.proxyPaths, r.URL.Path)
			f.proxyUsers = append(f.proxyUsers, r.Header.Get("Impersonate-User"))
			w.Header().Set("Content-Type", "application/json")
			if strings.HasSuffix(r.URL.Path, "/api/v1/query_range") {
				fmt.Fprintf(w, `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[[%d,"0.5"]]}]}}`, time.Now().UTC().Truncate(time.Hour).Unix())
				return
			}
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
		case strings.HasSuffix(r.URL.Path, "/services") && r.Method == http.MethodGet:
			f.listCalls++
			f.listUsers = append(f.listUsers, r.Header.Get("Impersonate-User"))
			w.Header().Set("Content-Type", "application/json")
			if f.denyList {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403}`))
				return
			}
			_, _ = w.Write([]byte(f.servicesRaw))
		default:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"major":"1","minor":"30","gitVersion":"v1.30.0"}`))
		}
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeAPIServer) lists() int { f.mu.Lock(); defer f.mu.Unlock(); return f.listCalls }
func (f *fakeAPIServer) proxied() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.proxyPaths...)
}

// settingsForFake isolates HOME and points a real manager at the fake API server.
func settingsForFake(t *testing.T, f *fakeAPIServer) *SettingsManager {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	kc := filepath.Join(home, "kubeconfig")
	cfg := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: " + f.URL + "\ncontexts:\n- name: dev\n  context: {cluster: c, user: u}\nusers:\n- name: u\n  user: {token: t}\ncurrent-context: dev\n"
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), kc)
	if err != nil {
		t.Fatal(err)
	}
	return NewSettingsManager(mgr)
}

type promStatus struct {
	Source     string `json:"source"`
	Target     string `json:"target"`
	Chosen     bool   `json:"chosen"`
	Candidates []struct {
		Target string `json:"target"`
	} `json:"candidates"`
}

func getStatus(t *testing.T, sm *SettingsManager, query string) promStatus {
	t.Helper()
	rec := httptest.NewRecorder()
	sm.HandlePromStatus(rec, httptest.NewRequest(http.MethodGet, "/api/prom/status?cluster=dev"+query, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var st promStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestPromAutoQueryGoesThroughTheAPIServerServiceProxy(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)

	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	paths := f.proxied()
	if len(paths) != 1 || paths[0] != "/api/v1/namespaces/monitoring/services/prometheus-server:80/proxy/api/v1/query" {
		t.Fatalf("proxied paths: %v", paths)
	}

	rec = httptest.NewRecorder()
	sm.HandlePromQueryRange(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query_range?cluster=dev&query=up&start=1&end=2&step=15", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("range status %d: %s", rec.Code, rec.Body)
	}
	if f.lists() != 1 {
		t.Fatalf("discovery must be cached across queries, listed %d times", f.lists())
	}
}

func TestPromManualURLAlwaysWins(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	manual := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer manual.Close()
	setPromURL(t, sm, "dev", manual.URL)
	// A pinned auto target must not beat a manual URL either.
	if err := sm.setPromTarget("dev", "monitoring/prometheus-server:80"); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if len(f.proxied()) != 0 || f.lists() != 0 {
		t.Fatalf("manual URL set but the API server was used (%d lists, %v)", f.lists(), f.proxied())
	}
	st := getStatus(t, sm, "")
	if st.Source != "manual" || st.Target != manual.URL {
		t.Fatalf("status %+v", st)
	}
}

func TestPromStatusAutoListsCandidatesBestFirst(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	st := getStatus(t, sm, "")
	if st.Source != "auto" || st.Target != "monitoring/prometheus-server:80" || st.Chosen {
		t.Fatalf("status %+v", st)
	}
	if len(st.Candidates) != 2 || st.Candidates[1].Target != "monitoring/prometheus-operated:9090" {
		t.Fatalf("candidates %+v", st.Candidates)
	}
}

func TestPromStatusCachesAndRefreshReloads(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	getStatus(t, sm, "")
	getStatus(t, sm, "")
	if f.lists() != 1 {
		t.Fatalf("second status must hit the cache, listed %d", f.lists())
	}
	f.mu.Lock()
	f.servicesRaw = `{"kind":"ServiceList","apiVersion":"v1","items":[{"metadata":{"namespace":"obs","name":"prometheus"},"spec":{"clusterIP":"10.0.0.9","ports":[{"name":"web","port":9090}]}}]}`
	f.mu.Unlock()
	if st := getStatus(t, sm, ""); st.Target != "monitoring/prometheus-server:80" {
		t.Fatalf("cached answer expected, got %+v", st)
	}
	if st := getStatus(t, sm, "&refresh=1"); st.Target != "obs/prometheus:9090" || f.lists() != 2 {
		t.Fatalf("refresh must re-discover: %+v (%d lists)", st, f.lists())
	}
}

func TestPromAutoImpersonatesTheRequestIdentity(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	ctx := clusters.WithIdentity(context.Background(), &clusters.Identity{Name: "alice", Groups: []string{"dev"}})
	req := httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.proxyUsers) != 1 || f.proxyUsers[0] != "alice" {
		t.Fatalf("proxy call impersonated %v, want alice", f.proxyUsers)
	}
	if len(f.listUsers) != 1 || f.listUsers[0] != "alice" {
		t.Fatalf("service list impersonated %v, want alice", f.listUsers)
	}
}

func TestPromDiscoveryIsCachedPerIdentity(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	for _, who := range []string{"alice", "bob", "alice"} {
		ctx := clusters.WithIdentity(context.Background(), &clusters.Identity{Name: who})
		rec := httptest.NewRecorder()
		sm.HandlePromStatus(rec, httptest.NewRequest(http.MethodGet, "/api/prom/status?cluster=dev", nil).WithContext(ctx))
	}
	if f.lists() != 2 {
		t.Fatalf("one discovery per identity expected, got %d", f.lists())
	}
}

func TestPromQuietWhenServiceListIsForbidden(t *testing.T) {
	f := newFakeAPIServer(t)
	f.denyList = true
	sm := settingsForFake(t, f)
	st := getStatus(t, sm, "")
	if st.Source != "none" || st.Target != "" {
		t.Fatalf("status %+v", st)
	}
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil))
	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("no Prometheus is a normal state (412), got %d", rec.Code)
	}
}

func TestPromChoosingATargetPinsItAndClearingGoesBackToAuto(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	post := func(body string) int {
		rec := httptest.NewRecorder()
		sm.HandlePromTarget(rec, httptest.NewRequest(http.MethodPost, "/api/prom/target", strings.NewReader(body)))
		return rec.Code
	}
	if c := post(`{"cluster":"dev","target":"nonsense"}`); c != http.StatusBadRequest {
		t.Fatalf("bad target: %d", c)
	}
	if c := post(`{"cluster":"dev","target":"monitoring/prometheus-operated:9090"}`); c != http.StatusOK {
		t.Fatalf("pin: %d", c)
	}
	st := getStatus(t, sm, "")
	if st.Source != "auto" || st.Target != "monitoring/prometheus-operated:9090" || !st.Chosen {
		t.Fatalf("status %+v", st)
	}
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil))
	if p := f.proxied(); rec.Code != 200 || len(p) != 1 || !strings.Contains(p[0], "prometheus-operated:9090/proxy") {
		t.Fatalf("pinned target not used: %d %v", rec.Code, p)
	}
	if c := post(`{"cluster":"dev","target":""}`); c != http.StatusOK {
		t.Fatalf("clear: %d", c)
	}
	if st := getStatus(t, sm, ""); st.Chosen || st.Target != "monitoring/prometheus-server:80" {
		t.Fatalf("after clear %+v", st)
	}
}

func TestSettingsSaveKeepsPrometheusTargets(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	if err := sm.setPromTarget("dev", "monitoring/prometheus-server:80"); err != nil {
		t.Fatal(err)
	}
	save(t, sm, `{"nodeShellImage":"busybox"}`)
	set, _ := sm.Load()
	if set.PrometheusTargets["dev"] != "monitoring/prometheus-server:80" {
		t.Fatalf("a settings save dropped the pinned target: %+v", set)
	}
}

func TestHistoryPrometheusSourceUsesTheDiscoveredService(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	api := &HistoryAPI{Settings: sm}
	hourEnd := time.Now().UTC().Truncate(time.Hour)
	rec := httptest.NewRecorder()
	url := "/x?cluster=dev&ns=shop&source=prometheus&from=" + hourEnd.Add(-2*time.Hour).Format(time.RFC3339) + "&to=" + hourEnd.Format(time.RFC3339)
	// HandleSeries needs a recorder for local reads only; source=prometheus does not.
	api.Recorder = history.NewRecorder(openTestStore(t))
	api.HandleSeries(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if len(f.proxied()) != 4 {
		t.Fatalf("expected 4 proxied range queries, got %v", f.proxied())
	}
}

func openTestStore(t *testing.T) *history.Store {
	t.Helper()
	st, err := history.Open(filepath.Join(t.TempDir(), "history"), history.Options{Location: time.UTC})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}
