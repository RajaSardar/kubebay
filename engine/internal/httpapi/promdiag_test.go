package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type diagStatus struct {
	Source    string   `json:"source"`
	Target    string   `json:"target"`
	Scope     string   `json:"scope"`
	Tried     []string `json:"tried"`
	Forbidden []string `json:"forbidden"`
	Error     string   `json:"error"`
	Default   string   `json:"defaultUrl"`
}

func getDiag(t *testing.T, sm *SettingsManager) diagStatus {
	t.Helper()
	rec := httptest.NewRecorder()
	sm.HandlePromStatus(rec, httptest.NewRequest(http.MethodGet, "/api/prom/status?cluster=dev", nil))
	var d diagStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func okProm() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[1,"3"]}]}}`))
	}))
}

// A default URL (often a dead port-forward to one cluster) must not hide the
// Prometheus that is in the cluster itself.
func TestDefaultURLIsOnlyAFallbackBehindAutoDetection(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	dead := httptest.NewServer(http.NotFoundHandler())
	deadURL := dead.URL
	dead.Close()
	save(t, sm, `{"prometheusUrl":"`+deadURL+`"}`)

	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil))
	if rec.Code != http.StatusOK || len(f.proxied()) != 1 {
		t.Fatalf("auto-detected service not used over the default URL: %d %v", rec.Code, f.proxied())
	}
	if st := getDiag(t, sm); st.Source != "auto" || st.Default != deadURL {
		t.Fatalf("status %+v", st)
	}
}

func TestDefaultURLIsUsedWhenNothingIsDetected(t *testing.T) {
	f := newFakeAPIServer(t)
	f.servicesRaw = `{"kind":"ServiceList","apiVersion":"v1","items":[]}`
	sm := settingsForFake(t, f)
	prom := okProm()
	defer prom.Close()
	save(t, sm, `{"prometheusUrl":"`+prom.URL+`"}`)
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil))
	if rec.Code != http.StatusOK || len(f.proxied()) != 0 {
		t.Fatalf("default URL not used: %d", rec.Code)
	}
	if st := getDiag(t, sm); st.Source != "default" || st.Target != prom.URL {
		t.Fatalf("status %+v", st)
	}
}

func TestStatusExplainsWhyNothingWasFound(t *testing.T) {
	f := newFakeAPIServer(t)
	f.denyList = true
	sm := settingsForFake(t, f)
	st := getDiag(t, sm)
	if st.Source != "none" || st.Scope != "namespaces" || len(st.Tried) < 8 || len(st.Forbidden) != len(st.Tried) || st.Error == "" {
		t.Fatalf("status %+v", st)
	}
}

func TestPromTestReportsTheExactURLQueryAndStatus(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	rec := httptest.NewRecorder()
	sm.HandlePromTest(rec, httptest.NewRequest(http.MethodGet, "/api/prom/test?cluster=dev", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var out struct {
		OK     bool   `json:"ok"`
		Source string `json:"source"`
		Cause  string `json:"cause"`
		Checks []struct {
			URL        string `json:"url"`
			Query      string `json:"query"`
			HTTPStatus int    `json:"httpStatus"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Source != "auto" || len(out.Checks) != 2 || out.Checks[0].HTTPStatus != 200 ||
		!strings.Contains(out.Checks[0].URL, "/namespaces/monitoring/services/prometheus-server:80/proxy/api/v1/query") ||
		!strings.Contains(out.Checks[1].Query, "container_cpu_usage_seconds_total") {
		t.Fatalf("report %+v", out)
	}
	// The fake answers an empty vector: Prometheus works but has no container metrics.
	if out.OK || out.Cause != "no-container-metrics" {
		t.Fatalf("cause %q ok %v", out.Cause, out.OK)
	}
}

func TestPromTestNamesAForbiddenServiceProxy(t *testing.T) {
	f := newFakeAPIServer(t)
	f.denyProxy = true
	sm := settingsForFake(t, f)
	rec := httptest.NewRecorder()
	sm.HandlePromTest(rec, httptest.NewRequest(http.MethodGet, "/api/prom/test?cluster=dev", nil))
	var out struct {
		Cause   string `json:"cause"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Cause != "forbidden" || !strings.Contains(out.Message, "services/proxy in monitoring") {
		t.Fatalf("%+v", out)
	}
}

func TestPromTestNamesAnUnreachableURLAndNoPrometheus(t *testing.T) {
	f := newFakeAPIServer(t)
	f.servicesRaw = `{"kind":"ServiceList","apiVersion":"v1","items":[]}`
	sm := settingsForFake(t, f)
	call := func() (string, int) {
		rec := httptest.NewRecorder()
		sm.HandlePromTest(rec, httptest.NewRequest(http.MethodGet, "/api/prom/test?cluster=dev", nil))
		var out struct {
			Cause string `json:"cause"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out.Cause, rec.Code
	}
	if c, code := call(); c != "none" || code != 200 {
		t.Fatalf("cause %q %d", c, code)
	}
	dead := httptest.NewServer(http.NotFoundHandler())
	u := dead.URL
	dead.Close()
	setPromURL(t, sm, "dev", u)
	if c, _ := call(); c != "unreachable" {
		t.Fatalf("cause %q", c)
	}
}

func TestPromTestRefusesAnotherUsersTargetOnASharedEngine(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	sm.SharedLocked = "in-cluster"
	rec := httptest.NewRecorder()
	sm.HandlePromTest(rec, httptest.NewRequest(http.MethodGet, "/api/prom/test?cluster=dev&target=other/prometheus:9090", nil))
	// A target is honoured only through the caller's own proxy access, never stored.
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	set, _ := sm.Load()
	if len(set.PrometheusTargets) != 0 {
		t.Fatalf("a test must not pin anything: %+v", set.PrometheusTargets)
	}
}

func TestQueryPrefixForBackendsThatServePrometheusBelowTheRoot(t *testing.T) {
	// covered in the prometheus package; here only that a vmselect target proxies below its prefix
	f := newFakeAPIServer(t)
	f.servicesRaw = `{"kind":"ServiceList","apiVersion":"v1","items":[{"metadata":{"namespace":"victoria-metrics","name":"vmselect-vmcluster"},"spec":{"clusterIP":"10.0.0.2","ports":[{"name":"http","port":8481}]}}]}`
	sm := settingsForFake(t, f)
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil))
	p := f.proxied()
	if len(p) != 1 || !strings.Contains(p[0], "/proxy/select/0/prometheus/api/v1/query") {
		t.Fatalf("%v", p)
	}
}

// An operator-set URL is deployment configuration: neither a stored default
// nor an auto-detected Service may sit in front of it.
func TestOperatorURLBeatsDefaultAndAutoDetection(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	prom := okProm()
	defer prom.Close()
	sm.Operator.PrometheusURL = prom.URL
	save(t, sm, `{"prometheusUrl":"http://127.0.0.1:1"}`)
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=dev&query=up", nil))
	if rec.Code != http.StatusOK || len(f.proxied()) != 0 {
		t.Fatalf("operator URL not used: %d proxied=%v", rec.Code, f.proxied())
	}
	if st := getDiag(t, sm); st.Source != "manual" || st.Target != prom.URL {
		t.Fatalf("status %+v", st)
	}
}

// The test report is shown on screen: credentials in a URL must not be echoed.
func TestPromTestDoesNotEchoURLCredentials(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := settingsForFake(t, f)
	prom := okProm()
	defer prom.Close()
	u := strings.Replace(prom.URL, "http://", "http://bob:s3cretpw@", 1)
	sm.Operator.PrometheusURL = u
	rec := httptest.NewRecorder()
	sm.HandlePromTest(rec, httptest.NewRequest(http.MethodGet, "/api/prom/test?cluster=dev", nil))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "s3cretpw") {
		t.Fatalf("%d leaked credentials: %s", rec.Code, rec.Body)
	}
}
