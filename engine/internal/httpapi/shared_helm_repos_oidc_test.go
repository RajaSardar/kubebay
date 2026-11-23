package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	repo "helm.sh/helm/v4/pkg/repo/v1"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// Internal security review: on a shared engine (in a cluster or with OIDC) the
// Helm repository list is one file every user's chart installs resolve
// "repo/chart" against. One user must not be able to add, repoint or remove
// a repository and so choose where another user's charts come from.

func sharedHelm() *HelmManager {
	return &HelmManager{ReposLocked: SharedHelmReposBlockReason(true, true)}
}

func postRepoAs(h func(http.ResponseWriter, *http.Request), path, body string, who *clusters.Identity) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if who != nil {
		req = signedIn(req, who)
	}
	h(rec, req)
	return rec
}

func repoURL(t *testing.T, dir, name string) string {
	t.Helper()
	f, err := repo.LoadFile(filepath.Join(dir, "repositories.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if e := f.Get(name); e != nil {
		return e.URL
	}
	return ""
}

func TestSharedHelmReposBlockReason(t *testing.T) {
	if SharedHelmReposBlockReason(false, false) != "" {
		t.Error("desktop must keep managing its own repositories")
	}
	for _, c := range [][2]bool{{true, false}, {false, true}, {true, true}} {
		if SharedHelmReposBlockReason(c[0], c[1]) == "" {
			t.Errorf("in-cluster=%v oidc=%v must lock the shared repository list", c[0], c[1])
		}
	}
}

func TestOneOIDCUserCannotRepointAnotherUsersHelmRepo(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	good, _ := indexServer(t, &body)
	evil, evilHits := indexServer(t, &body)
	dir := twoRepos(t, good.URL, good.URL)
	h := sharedHelm()

	// Alice repoints "one" at her own server.
	rec := postRepoAs(h.HandleAddRepo, "/api/helm/repos/add", `{"name":"one","url":"`+evil.URL+`"}`, alice)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("alice repointed a shared repo: status %d %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "operator") {
		t.Errorf("refusal does not say why: %s", rec.Body)
	}
	if u := repoURL(t, dir, "one"); u != good.URL {
		t.Fatalf("repo one now points at %q", u)
	}
	if evilHits.Load() != 0 {
		t.Errorf("the engine fetched alice's index %d times", evilHits.Load())
	}

	// Credentials on an existing name are a change too.
	rec = postRepoAs(h.HandleAddRepo, "/api/helm/repos/add", `{"name":"one","url":"`+good.URL+`","username":"a","password":"b"}`, alice)
	if rec.Code != http.StatusForbidden {
		t.Errorf("alice changed a shared repo's credentials: status %d", rec.Code)
	}

	// A new name would be resolved for bob's "new/chart" installs as well.
	rec = postRepoAs(h.HandleAddRepo, "/api/helm/repos/add", `{"name":"new","url":"`+evil.URL+`"}`, alice)
	if rec.Code != http.StatusForbidden {
		t.Errorf("alice added a shared repo: status %d", rec.Code)
	}
	if u := repoURL(t, dir, "new"); u != "" {
		t.Errorf("repo new was saved: %q", u)
	}

	rec = postRepoAs(h.HandleRemoveRepo, "/api/helm/repos/remove", `{"name":"two"}`, bob)
	if rec.Code != http.StatusForbidden {
		t.Errorf("bob removed a shared repo: status %d", rec.Code)
	}
	if u := repoURL(t, dir, "two"); u != good.URL {
		t.Errorf("repo two is gone or changed: %q", u)
	}
}

func TestSharedEngineStillRefreshesTheOperatorsRepos(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	srv, hits := indexServer(t, &body)
	dir := twoRepos(t, srv.URL, srv.URL)
	h := sharedHelm()

	rec := httptest.NewRecorder()
	h.HandleUpdateRepos(rec, signedIn(httptest.NewRequest(http.MethodPost, "/api/helm/repos/update?repo=one", strings.NewReader("{}")), alice))
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", rec.Code, rec.Body)
	}
	if hits.Load() != 1 {
		t.Errorf("refresh fetched %d times, want 1", hits.Load())
	}

	// Re-adding a repo exactly as configured changes nothing, so it is a
	// refresh: one-click installs of a known chart keep working.
	rec = postRepoAs(h.HandleAddRepo, "/api/helm/repos/add", `{"name":"two","url":"`+srv.URL+`"}`, bob)
	if rec.Code != http.StatusOK {
		t.Fatalf("re-adding an unchanged repo: %d %s", rec.Code, rec.Body)
	}
	if u := repoURL(t, dir, "two"); u != srv.URL {
		t.Errorf("repo two now %q", u)
	}
}

func TestDesktopStillAddsRepointsAndRemovesRepos(t *testing.T) {
	var body atomic.Value
	body.Store(okIndex)
	a, _ := indexServer(t, &body)
	b, _ := indexServer(t, &body)
	dir := twoRepos(t, a.URL, a.URL)
	h := &HelmManager{}

	if rec := postRepoAs(h.HandleAddRepo, "/api/helm/repos/add", `{"name":"one","url":"`+b.URL+`"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("repoint: %d %s", rec.Code, rec.Body)
	}
	if u := repoURL(t, dir, "one"); u != b.URL {
		t.Errorf("repo one %q, want %q", u, b.URL)
	}
	if rec := postRepoAs(h.HandleAddRepo, "/api/helm/repos/add", `{"name":"three","url":"`+b.URL+`"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("add: %d %s", rec.Code, rec.Body)
	}
	if rec := postRepoAs(h.HandleRemoveRepo, "/api/helm/repos/remove", `{"name":"two"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("remove: %d %s", rec.Code, rec.Body)
	}
	if u := repoURL(t, dir, "two"); u != "" {
		t.Errorf("repo two still configured: %q", u)
	}
}

func TestSettingsSayWhenHelmReposAreLocked(t *testing.T) {
	f := newFakeAPIServer(t)
	sm := lockedSettings(t, f)
	sm.HelmReposLocked = SharedHelmReposBlockReason(true, true)
	rec := httptest.NewRecorder()
	sm.HandleGet(rec, signedIn(httptest.NewRequest(http.MethodGet, "/api/settings", nil), alice))
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["helmReposLocked"] != sm.HelmReposLocked {
		t.Errorf("helmReposLocked = %v, want the reason", got["helmReposLocked"])
	}

	desk := settingsForFake(t, f)
	rec = httptest.NewRecorder()
	desk.HandleGet(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	got = map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if v, ok := got["helmReposLocked"]; ok && v != "" {
		t.Errorf("desktop reports locked repos: %v", v)
	}
}

// --- Operator-configured repositories ---

func TestParseOperatorHelmRepos(t *testing.T) {
	got, err := ParseOperatorHelmRepos(" bitnami=https://charts.bitnami.example , mirror=http://charts.corp:8080/stable ")
	if err != nil {
		t.Fatal(err)
	}
	want := []OperatorHelmRepo{{Name: "bitnami", URL: "https://charts.bitnami.example"}, {Name: "mirror", URL: "http://charts.corp:8080/stable"}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if got, err := ParseOperatorHelmRepos(""); err != nil || len(got) != 0 {
		t.Errorf("empty: %v %v", got, err)
	}
	for _, bad := range []string{"noequals", "=https://x", "../x=https://x", "a=ftp://x", "a=", "a=https://x,a=https://y"} {
		if _, err := ParseOperatorHelmRepos(bad); err == nil {
			t.Errorf("%q: want an error", bad)
		}
	}
}

func TestSeedOperatorHelmReposWritesThemOverAnyStoredEntry(t *testing.T) {
	dir := twoRepos(t, "https://old.example/one", "https://old.example/two")
	h := &HelmManager{}
	if err := h.SeedOperatorRepos([]OperatorHelmRepo{{Name: "one", URL: "https://operator.example/one"}, {Name: "fresh", URL: "https://operator.example/fresh"}}); err != nil {
		t.Fatal(err)
	}
	if u := repoURL(t, dir, "one"); u != "https://operator.example/one" {
		t.Errorf("one = %q", u)
	}
	if u := repoURL(t, dir, "fresh"); u != "https://operator.example/fresh" {
		t.Errorf("fresh = %q", u)
	}
	if u := repoURL(t, dir, "two"); u != "https://old.example/two" {
		t.Errorf("an unlisted repo changed: %q", u)
	}
	// No repositories file yet (a fresh pod).
	fresh := t.TempDir()
	t.Setenv("HELM_REPOSITORY_CONFIG", filepath.Join(fresh, "sub", "repositories.yaml"))
	if err := h.SeedOperatorRepos([]OperatorHelmRepo{{Name: "one", URL: "https://operator.example/one"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(fresh, "sub", "repositories.yaml")); err != nil {
		t.Errorf("repositories file not written: %v", err)
	}
}
