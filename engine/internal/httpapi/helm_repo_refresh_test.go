package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// indexServer serves a Helm index (or whatever body says) and counts the fetches.
func indexServer(t *testing.T, body *atomic.Value) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	hits := &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/index.yaml" {
			http.NotFound(w, r)
			return
		}
		hits.Add(1)
		_, _ = io.WriteString(w, body.Load().(string))
	}))
	t.Cleanup(srv.Close)
	return srv, hits
}

const okIndex = "apiVersion: v1\nentries:\n  web:\n  - {apiVersion: v2, name: web, version: 1.0.0, urls: [\"web-1.0.0.tgz\"]}\ngenerated: \"2026-01-01T00:00:00Z\"\n"

// twoRepos configures repositories "one" and "two", each on its own server.
func twoRepos(t *testing.T, oneURL, twoURL string) string {
	t.Helper()
	dir := repoEnv(t)
	cfg := "apiVersion: \"\"\ngenerated: \"0001-01-01T00:00:00Z\"\nrepositories:\n- name: one\n  url: " + oneURL + "\n- name: two\n  url: " + twoURL + "\n"
	if err := os.WriteFile(filepath.Join(dir, "repositories.yaml"), []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func updateRepos(h *HelmManager, q string) (*httptest.ResponseRecorder, map[string]string) {
	rec := httptest.NewRecorder()
	h.HandleUpdateRepos(rec, httptest.NewRequest(http.MethodPost, "/api/helm/repos/update?"+q, strings.NewReader("{}")))
	out := map[string]string{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

// Refresh on one repository re-fetches that repository's index and no other.
func TestUpdateReposRefreshesOnlyTheNamedRepo(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	one, oneHits := indexServer(t, &body)
	two, twoHits := indexServer(t, &body)
	dir := twoRepos(t, one.URL, two.URL)

	rec, out := updateRepos(&HelmManager{}, "repo=one")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if len(out) != 1 || out["one"] != "ok" {
		t.Errorf("results = %v, want only one: ok", out)
	}
	if oneHits.Load() != 1 || twoHits.Load() != 0 {
		t.Errorf("index fetches: one %d, two %d; want 1 and 0", oneHits.Load(), twoHits.Load())
	}
	if _, err := os.Stat(filepath.Join(dir, "cache", "one-index.yaml")); err != nil {
		t.Errorf("one's index not cached: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "cache", "two-index.yaml")); err == nil {
		t.Error("two's index was cached, but only one was asked for")
	}
}

// With no repository named, every repository is refreshed as before.
func TestUpdateReposWithoutANameRefreshesThemAll(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	one, oneHits := indexServer(t, &body)
	two, twoHits := indexServer(t, &body)
	twoRepos(t, one.URL, two.URL)

	_, out := updateRepos(&HelmManager{}, "")
	if out["one"] != "ok" || out["two"] != "ok" || oneHits.Load() != 1 || twoHits.Load() != 1 {
		t.Errorf("results %v, fetches %d %d", out, oneHits.Load(), twoHits.Load())
	}
}

func TestUpdateReposUnknownRepoIs404(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	one, _ := indexServer(t, &body)
	twoRepos(t, one.URL, one.URL)
	if rec, _ := updateRepos(&HelmManager{}, "repo=nope"); rec.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404: %s", rec.Code, rec.Body)
	}
}

// A single-repo refresh keeps the SSRF guard: a metadata address is never fetched.
func TestUpdateReposRefusesAMetadataAddressForOneRepo(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	one, _ := indexServer(t, &body)
	twoRepos(t, one.URL, "http://169.254.169.254")
	_, out := updateRepos(&HelmManager{}, "repo=two")
	if !strings.HasPrefix(out["two"], "error: not fetched") || !strings.Contains(out["two"], "link-local") {
		t.Errorf("two = %q, want a refusal naming the link-local address", out["two"])
	}
}

// An index that fails Helm's validation is reported and never replaces the cached one.
func TestUpdateReposKeepsTheCachedIndexWhenTheNewOneIsInvalid(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	one, _ := indexServer(t, &body)
	dir := twoRepos(t, one.URL, one.URL)
	if _, out := updateRepos(&HelmManager{}, "repo=one"); out["one"] != "ok" {
		t.Fatalf("first refresh: %q", out["one"])
	}
	body.Store("this is not an index")
	_, out := updateRepos(&HelmManager{}, "repo=one")
	if !strings.HasPrefix(out["one"], "error: ") {
		t.Errorf("one = %q, want an error", out["one"])
	}
	cached, err := os.ReadFile(filepath.Join(dir, "cache", "one-index.yaml"))
	if err != nil || string(cached) != okIndex {
		t.Errorf("cached index changed: %q %v", cached, err)
	}
}

// The repo list says when each repository's index was last fetched.
func TestReposListSaysWhenEachIndexWasLastUpdated(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	one, _ := indexServer(t, &body)
	twoRepos(t, one.URL, one.URL)
	before := time.Now().Add(-2 * time.Second)
	updateRepos(&HelmManager{}, "repo=one")

	rec := httptest.NewRecorder()
	(&HelmManager{}).HandleRepos(rec, httptest.NewRequest(http.MethodGet, "/api/helm/repos", nil))
	var list []RepoSummary
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || len(list) != 2 {
		t.Fatalf("err %v body %s", err, rec.Body)
	}
	byName := map[string]RepoSummary{list[0].Name: list[0], list[1].Name: list[1]}
	got, err := time.Parse(time.RFC3339, byName["one"].Updated)
	if err != nil || got.Before(before) {
		t.Errorf("one updated = %q (%v), want a recent RFC 3339 time", byName["one"].Updated, err)
	}
	if byName["two"].Updated != "" {
		t.Errorf("two was never fetched, updated = %q", byName["two"].Updated)
	}
}
