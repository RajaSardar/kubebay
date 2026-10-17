package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// KB-04: the desktop app asks the engine whether anything would be cut off by
// a restart before it installs an update.
func TestActivityReportsWhatARestartWouldInterrupt(t *testing.T) {
	hub := stream.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	h := Router(Deps{Hub: hub, PF: &PFManager{}}, "secret")

	get := func() (int, Activity) {
		req := httptest.NewRequest(http.MethodGet, "/api/activity", nil)
		req.Header.Set("X-Kubebay-Token", "secret")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var a Activity
		_ = json.Unmarshal(rec.Body.Bytes(), &a)
		return rec.Code, a
	}
	code, a := get()
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if a != (Activity{}) {
		t.Errorf("idle engine reports %+v, want all zero", a)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/activity", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("without the token: %d, want 401", rec.Code)
	}
}

// A write (apply, delete, scale, Helm upgrade…) counts from the moment it
// arrives until its response is written. Reads don't count.
func TestWriteTrackerCountsWritesInFlight(t *testing.T) {
	var tr writeTracker
	release := make(chan struct{})
	entered := make(chan struct{}, 2)
	h := tr.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entered <- struct{}{}
		<-release
	}))

	done := make(chan struct{})
	go func() {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/yaml/apply", nil))
		close(done)
	}()
	<-entered
	if n := tr.inFlight(); n != 1 {
		t.Errorf("during a POST: %d writes, want 1", n)
	}

	go h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/clusters", nil))
	<-entered
	if n := tr.inFlight(); n != 1 {
		t.Errorf("a GET changed the count to %d", n)
	}

	close(release)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the POST never finished")
	}
	if n := tr.inFlight(); n != 0 {
		t.Errorf("after the POST: %d writes, want 0", n)
	}
}

// A restart stops every port-forward, not only the caller's (in-cluster mode
// lists each user's own).
func TestActivityCountsEveryOwnersPortForwards(t *testing.T) {
	pf := NewPFManager(nil)
	pf.m["a"] = &pfEntry{owner: "alice"}
	pf.m["b"] = &pfEntry{owner: "bob"}
	h := Router(Deps{PF: pf}, "secret")
	req := httptest.NewRequest(http.MethodGet, "/api/activity", nil)
	req.Header.Set("X-Kubebay-Token", "secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var a Activity
	_ = json.Unmarshal(rec.Body.Bytes(), &a)
	if a.PortForwards != 2 {
		t.Errorf("portForwards = %d, want 2 (both owners')", a.PortForwards)
	}
}
