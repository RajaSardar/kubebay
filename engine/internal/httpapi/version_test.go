package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// KB-15: an exported findings report records the Kubebay version, so the
// shell asks the engine for it. Behind the token, unlike /api/healthz.
func TestVersionNeedsTheTokenAndReportsTheBuild(t *testing.T) {
	h := Router(Deps{Version: "v0.7.0"}, "secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("without the token: %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	req.Header.Set("X-Kubebay-Token", "secret")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var got struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusOK || got.Version != "v0.7.0" {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}
