package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestBuildPromURL(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		params map[string]string
		want   string
	}{
		{
			name:   "query_range with all params",
			path:   "/api/v1/query_range",
			params: map[string]string{"query": "up", "start": "1", "end": "2", "step": "15"},
			want:   "http://prom.local/api/v1/query_range?end=2&query=up&start=1&step=15",
		},
		{
			name:   "instant query with just a query",
			path:   "/api/v1/query",
			params: map[string]string{"query": "up"},
			want:   "http://prom.local/api/v1/query?query=up",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := buildPromURL("http://prom.local", tc.path, tc.params)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("buildPromURL() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBuildPromURL_RejectsBadBase(t *testing.T) {
	_, err := buildPromURL("://not-a-url", "/api/v1/query", map[string]string{"query": "up"})
	if err == nil {
		t.Fatal("expected an error for a malformed base URL")
	}
}

func TestHandlePromQuery_ProxiesToInstantEndpoint(t *testing.T) {
	var gotPath string
	var gotQuery url.Values
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data":   map[string]interface{}{"resultType": "vector", "result": []interface{}{}},
		})
	}))
	defer prom.Close()

	sm := settingsManagerWithPrometheus(t, prom.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=kind-dev&query=up", nil)
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if gotPath != "/api/v1/query" {
		t.Errorf("proxied path = %q, want /api/v1/query", gotPath)
	}
	if gotQuery.Get("query") != "up" {
		t.Errorf("proxied query param = %q, want up", gotQuery.Get("query"))
	}
}

func TestHandlePromQuery_RequiresClusterAndQuery(t *testing.T) {
	sm := settingsManagerWithPrometheus(t, "http://unused")

	cases := []string{
		"/api/prom/query?query=up",
		"/api/prom/query?cluster=kind-dev",
	}
	for _, target := range cases {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		rec := httptest.NewRecorder()
		sm.HandlePromQuery(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("target %q: status = %d, want 400", target, rec.Code)
		}
	}
}

func settingsManagerWithPrometheus(t *testing.T, promURL string) *SettingsManager {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	sm := NewSettingsManager(nil)
	if err := sm.save(&AppSettings{PrometheusURL: promURL}); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	return sm
}

func TestHandlePromQuery_PreconditionFailedWhenNotConfigured(t *testing.T) {
	sm := settingsManagerWithPrometheus(t, "")
	req := httptest.NewRequest(http.MethodGet, "/api/prom/query?cluster=kind-dev&query=up", nil)
	rec := httptest.NewRecorder()
	sm.HandlePromQuery(rec, req)
	if rec.Code != http.StatusPreconditionFailed {
		t.Errorf("status = %d, want 412 when no Prometheus URL is configured", rec.Code)
	}
}
