package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The heap profile is how a user's live heap gets broken down; it is behind
// the session token like every other endpoint.
func TestDebugPprofHeapIsTokenGated(t *testing.T) {
	h := Router(Deps{}, "secret")

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/debug/pprof/heap", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token: status %d, want 401", rec.Code)
	}

	for _, name := range []string{"heap", "allocs", "goroutine"} {
		req := httptest.NewRequest(http.MethodGet, "/api/debug/pprof/"+name, nil)
		req.Header.Set("X-Kubebay-Token", "secret")
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK || rec.Body.Len() == 0 {
			t.Fatalf("%s: status %d, %d bytes; want 200 with a profile", name, rec.Code, rec.Body.Len())
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/debug/pprof/nope", nil)
	req.Header.Set("X-Kubebay-Token", "secret")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown profile: status %d, want 404", rec.Code)
	}
}
