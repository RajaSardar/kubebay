package httpapi

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime/pprof"
	"strings"
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

// A profile that cannot be written is a plain 500 with what to do next, not
// a 200 download of a cut-off file: the headers wait for the whole profile.
func TestDebugPprofWriteFailureIsAPlainError(t *testing.T) {
	prev := writeProfile
	t.Cleanup(func() { writeProfile = prev })
	writeProfile = func(_ *pprof.Profile, w io.Writer) error {
		_, _ = w.Write([]byte("partial"))
		return errors.New("disk on fire")
	}
	req := httptest.NewRequest(http.MethodGet, "/api/debug/pprof/heap", nil)
	req.Header.Set("X-Kubebay-Token", "secret")
	rec := httptest.NewRecorder()
	Router(Deps{}, "secret").ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500", rec.Code)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != "" {
		t.Errorf("Content-Disposition %q on a failed profile: the browser would save a broken file", cd)
	}
	body := rec.Body.String()
	if strings.Contains(body, "partial") || strings.Contains(body, "disk on fire") {
		t.Errorf("body %q: want a plain sentence, not the partial profile or the raw error", body)
	}
	if !strings.Contains(body, "try again") {
		t.Errorf("body %q: want what to do next", body)
	}
}
