package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

// Engine routes outside /api/ must still reach the API router: the MCP
// endpoint (/mcp) returned the SPA's index.html in the shipped binary.
func TestSPAAndFallbackSendEngineRoutesToTheAPI(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-From", "api")
	})
	ui := fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}}
	for name, h := range map[string]http.Handler{"spa": spaHandler(ui, api), "fallback": fallbackNotice(api)} {
		for _, tc := range []struct {
			method, path string
			api          bool
		}{
			{http.MethodPost, "/mcp", true},
			{http.MethodGet, "/ws", true},
			{http.MethodGet, "/api/clusters", true},
			{http.MethodGet, "/", false},
			{http.MethodGet, "/mcp-guide", false},
			{http.MethodGet, "/pods", false},
		} {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
			if got := rec.Header().Get("X-From") == "api"; got != tc.api {
				t.Errorf("%s %s %s: reached API = %v, want %v", name, tc.method, tc.path, got, tc.api)
			}
		}
	}
}
