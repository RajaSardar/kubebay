package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	repo "helm.sh/helm/v4/pkg/repo/v1"
)

func repoEnv(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HELM_REPOSITORY_CONFIG", filepath.Join(dir, "repositories.yaml"))
	t.Setenv("HELM_REPOSITORY_CACHE", filepath.Join(dir, "cache"))
	t.Setenv("HELM_CONFIG_HOME", dir)
	t.Setenv("HELM_CACHE_HOME", dir)
	t.Setenv("HELM_DATA_HOME", dir)
	return dir
}

func authedIndexServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != "ada" || p != "s3cret" {
			http.Error(w, "nope", http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, "apiVersion: v1\nentries: {}\ngenerated: \"2026-01-01T00:00:00Z\"\n")
	}))
	t.Cleanup(srv.Close)
	return srv
}

func postRepo(h func(http.ResponseWriter, *http.Request), path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
	return rec
}

func TestAddRepoWithBasicAuthSavesItAndNeverEchoesThePassword(t *testing.T) {
	dir := repoEnv(t)
	srv := authedIndexServer(t)
	h := &HelmManager{}

	rec := postRepo(h.HandleAddRepo, "/api/helm/repos/add", `{"name":"priv","url":"`+srv.URL+`","username":"ada","password":"s3cret"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "s3cret") {
		t.Errorf("response echoes the password: %s", rec.Body)
	}
	f, err := repo.LoadFile(filepath.Join(dir, "repositories.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	e := f.Get("priv")
	if e == nil || e.Username != "ada" || e.Password != "s3cret" {
		t.Fatalf("entry not saved with credentials: %+v", e)
	}

	list := httptest.NewRecorder()
	h.HandleRepos(list, httptest.NewRequest(http.MethodGet, "/api/helm/repos", nil))
	if strings.Contains(list.Body.String(), "s3cret") {
		t.Errorf("repo list leaks the password: %s", list.Body)
	}
}

func TestAddRepoWithWrongCredentialsIsRefusedAndNotSaved(t *testing.T) {
	dir := repoEnv(t)
	srv := authedIndexServer(t)
	rec := postRepo((&HelmManager{}).HandleAddRepo, "/api/helm/repos/add", `{"name":"priv","url":"`+srv.URL+`","username":"ada","password":"wrong"}`)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d, want 502: %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(dir, "repositories.yaml")); err == nil {
		t.Error("a repo that failed validation was saved")
	}
}

func TestAddRepoRefusesANameThatCouldEscapeTheCacheDirectory(t *testing.T) {
	repoEnv(t)
	for _, name := range []string{"../evil", "a/b", ".hidden", "a b", ""} {
		rec := postRepo((&HelmManager{}).HandleAddRepo, "/api/helm/repos/add", `{"name":"`+name+`","url":"https://example.com"}`)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("name %q: status %d, want 400", name, rec.Code)
		}
	}
}

func TestRemoveRepoDropsTheEntryAndItsCachedIndex(t *testing.T) {
	storeRepo(t, "")
	h := &HelmManager{}
	cache := h.settings().RepositoryCache
	if _, err := os.Stat(filepath.Join(cache, "store-index.yaml")); err != nil {
		t.Fatal(err)
	}

	rec := postRepo(h.HandleRemoveRepo, "/api/helm/repos/remove", `{"name":"store"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	f, err := repo.LoadFile(h.settings().RepositoryConfig)
	if err != nil {
		t.Fatal(err)
	}
	if f.Has("store") {
		t.Error("repo still configured")
	}
	if _, err := os.Stat(filepath.Join(cache, "store-index.yaml")); !os.IsNotExist(err) {
		t.Errorf("cached index left behind: %v", err)
	}
}

func TestRemoveRepoUnknownIs404AndBadNameIs400(t *testing.T) {
	storeRepo(t, "")
	h := &HelmManager{}
	if rec := postRepo(h.HandleRemoveRepo, "/x", `{"name":"nope"}`); rec.Code != http.StatusNotFound {
		t.Errorf("unknown: status %d, want 404", rec.Code)
	}
	if rec := postRepo(h.HandleRemoveRepo, "/x", `{"name":"../store"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad name: status %d, want 400", rec.Code)
	}
}
