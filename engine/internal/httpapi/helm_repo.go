package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

	"sigs.k8s.io/yaml"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"helm.sh/helm/v4/pkg/chart"
	"helm.sh/helm/v4/pkg/chart/loader"
	"helm.sh/helm/v4/pkg/cli"
	"helm.sh/helm/v4/pkg/getter"
	repo "helm.sh/helm/v4/pkg/repo/v1"
)

type RepoSummary struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	// Updated is when the repository's index was last fetched (RFC 3339), from
	// the cached index file; absent when it never was.
	Updated string `json:"updated,omitempty"`
}

func (h *HelmManager) HandleRepos(w http.ResponseWriter, r *http.Request) {
	settings := h.settings()
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]RepoSummary{})
		return
	}
	out := make([]RepoSummary, 0, len(f.Repositories))
	for _, e := range f.Repositories {
		s := RepoSummary{Name: e.Name, URL: e.URL}
		if repoNameRE.MatchString(e.Name) {
			if fi, err := os.Stat(filepath.Join(settings.RepositoryCache, e.Name+"-index.yaml")); err == nil {
				s.Updated = fi.ModTime().UTC().Format(time.RFC3339)
			}
		}
		out = append(out, s)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// HandleUpdateRepos re-fetches repository indexes: every configured repository,
// or with ?repo=name only that one. Each URL is checked by the outbound guard
// before it is fetched, and a new index replaces the cached one only once Helm
// has loaded and validated it.
func (h *HelmManager) HandleUpdateRepos(w http.ResponseWriter, r *http.Request) {
	settings := h.settings()
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		http.Error(w, "no repositories configured (run: helm repo add …)", http.StatusBadRequest)
		return
	}
	entries := f.Repositories
	if only := r.URL.Query().Get("repo"); only != "" {
		e := f.Get(only)
		if e == nil {
			http.Error(w, fmt.Sprintf("repository %q is not configured", only), http.StatusNotFound)
			return
		}
		entries = []*repo.Entry{e}
	}
	type result struct {
		name string
		msg  string
	}
	done := make(chan result, len(entries))
	for _, entry := range entries {
		go func(e *repo.Entry) {
			done <- result{e.Name, h.refreshRepo(settings, e)}
		}(entry)
	}
	results := map[string]string{}
	for range entries {
		res := <-done
		results[res.name] = res.msg
	}
	writeJSON(w, results)
}

// refreshRepo fetches one repository's index into the cache and says how it
// went: "ok", or "error: …".
func (h *HelmManager) refreshRepo(settings *cli.EnvSettings, e *repo.Entry) string {
	if verr := h.Outbound.ValidateURL(e.URL); verr != nil {
		return "error: not fetched: " + verr.Error()
	}
	cr, cerr := repo.NewChartRepository(e, h.getters(settings, e))
	if cerr != nil {
		return "error: " + cerr.Error()
	}
	cr.CachePath = settings.RepositoryCache
	if _, derr := cr.DownloadIndexFile(); derr != nil {
		return "error: " + derr.Error()
	}
	return "ok"
}

// addOrUpdateRepoEntry adds a new repo entry to f, or updates an existing
// one's URL in place, returning whether the file actually changed so the
// caller only needs to persist it to disk when something moved.
func addOrUpdateRepoEntry(f *repo.File, name, url, username, password string) (*repo.Entry, bool) {
	if existing := f.Get(name); existing != nil {
		if existing.URL == url && existing.Username == username && existing.Password == password {
			return existing, false
		}
		existing.URL = url
		existing.Username = username
		existing.Password = password
		return existing, true
	}
	entry := &repo.Entry{Name: name, URL: url, Username: username, Password: password}
	f.Add(entry)
	return entry, true
}

type AddRepoRequest struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

// repoNameRE is what a repository name may be. The name becomes part of a cache
// file path, so it must not hold a separator or a leading dot.
var repoNameRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`)

type RemoveRepoRequest struct {
	Name string `json:"name"`
}

// HandleRemoveRepo drops a repository from the local Helm config and deletes its
// cached index. Releases installed from it are untouched.
func (h *HelmManager) HandleRemoveRepo(w http.ResponseWriter, r *http.Request) {
	if h.refuseIfReposLocked(w) {
		return
	}
	var req RemoveRepoRequest
	if err := decodeBody(r, &req); err != nil || !repoNameRE.MatchString(req.Name) {
		http.Error(w, "a valid repository name is required", http.StatusBadRequest)
		return
	}
	settings := h.settings()
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil || !f.Has(req.Name) {
		http.Error(w, fmt.Sprintf("repository %q is not configured", req.Name), http.StatusNotFound)
		return
	}
	f.Remove(req.Name)
	if err := f.WriteFile(settings.RepositoryConfig, 0o600); err != nil {
		http.Error(w, fmt.Sprintf("write repo file: %v", err), http.StatusInternalServerError)
		return
	}
	_ = os.Remove(filepath.Join(settings.RepositoryCache, req.Name+"-index.yaml"))
	_ = os.Remove(filepath.Join(settings.RepositoryCache, req.Name+"-charts.txt"))
	h.Audit.RecordCtx(r.Context(), audit.Entry{
		Action:    "helm-repo-remove",
		GVR:       helmRepoGVR,
		Resource:  req.Name,
		UserAgent: r.Header.Get("User-Agent"),
	})
	writeJSON(w, map[string]bool{"ok": true})
}

// HandleAddRepo is the missing piece backlog #2/#3 flagged: without it, a
// chart repo not already in the local repositories.yaml can never be
// installed from at all. Validates the repo by downloading its index
// before persisting the entry, so a typo'd URL never silently gets saved.
func (h *HelmManager) HandleAddRepo(w http.ResponseWriter, r *http.Request) {
	var req AddRepoRequest
	if err := decodeBody(r, &req); err != nil || req.Name == "" || req.URL == "" {
		http.Error(w, "name and url required", http.StatusBadRequest)
		return
	}
	if !repoNameRE.MatchString(req.Name) {
		http.Error(w, "repository name: use letters, digits, dot, dash or underscore, starting with a letter or digit", http.StatusBadRequest)
		return
	}
	if err := h.Outbound.ValidateURL(req.URL); err != nil {
		http.Error(w, "repository URL: "+err.Error(), http.StatusBadRequest)
		return
	}

	settings := h.settings()
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			http.Error(w, fmt.Sprintf("load repo file: %v", err), http.StatusInternalServerError)
			return
		}
		f = repo.NewFile()
	}
	// On a shared engine only a no-op re-add, which just refreshes the
	// index, gets through: a new or changed entry is another user's chart source.
	if h.ReposLocked != "" {
		e := f.Get(req.Name)
		if e == nil || e.URL != req.URL || e.Username != req.Username || e.Password != req.Password {
			h.refuseIfReposLocked(w)
			return
		}
	}

	entry, changed := addOrUpdateRepoEntry(f, req.Name, req.URL, req.Username, req.Password)

	cr, cerr := repo.NewChartRepository(entry, h.getters(settings, entry))
	if cerr != nil {
		http.Error(w, fmt.Sprintf("repo config: %v", cerr), http.StatusBadRequest)
		return
	}
	cr.CachePath = settings.RepositoryCache
	if _, derr := cr.DownloadIndexFile(); derr != nil {
		http.Error(w, fmt.Sprintf("fetch index: %v", derr), http.StatusBadGateway)
		return
	}

	if changed {
		if err := os.MkdirAll(filepath.Dir(settings.RepositoryConfig), 0o700); err != nil {
			http.Error(w, fmt.Sprintf("mkdir: %v", err), http.StatusInternalServerError)
			return
		}
		if err := f.WriteFile(settings.RepositoryConfig, 0o600); err != nil {
			http.Error(w, fmt.Sprintf("write repo file: %v", err), http.StatusInternalServerError)
			return
		}
	}

	h.Audit.RecordCtx(r.Context(), audit.Entry{
		Action:    "helm-repo-add",
		GVR:       helmRepoGVR,
		Resource:  entry.Name,
		Detail:    entry.URL,
		UserAgent: r.Header.Get("User-Agent"),
	})
	writeJSON(w, RepoSummary{Name: entry.Name, URL: entry.URL})
}

func (h *HelmManager) HandleCharts(w http.ResponseWriter, r *http.Request) {
	repoName := r.URL.Query().Get("repo")
	if repoName == "" {
		http.Error(w, "repo required", http.StatusBadRequest)
		return
	}
	settings := h.settings()
	idxPath := filepath.Join(settings.RepositoryCache, repoName+"-index.yaml")
	if _, err := os.Stat(idxPath); err != nil {
		http.Error(w, fmt.Sprintf("index for %q not cached — update repos first", repoName), http.StatusNotFound)
		return
	}
	idx, err := repo.LoadIndexFile(idxPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("load index: %v", err), http.StatusBadGateway)
		return
	}
	type chartEntry struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Version     string   `json:"version"`
		AppVersion  string   `json:"appVersion,omitempty"`
		Versions    int      `json:"versions"`
		Keywords    []string `json:"keywords,omitempty"`
		Deprecated  bool     `json:"deprecated,omitempty"`
	}
	out := []chartEntry{}
	names := make([]string, 0, len(idx.Entries))
	for n := range idx.Entries {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		versions := idx.Entries[n]
		if len(versions) == 0 {
			continue
		}
		latest := versions[0]
		desc := ""
		appVer := ""
		ver := ""
		var keywords []string
		deprecated := false
		if latest.Metadata != nil {
			keywords = latest.Metadata.Keywords
			deprecated = latest.Metadata.Deprecated
			desc = latest.Metadata.Description
			appVer = latest.Metadata.AppVersion
			ver = latest.Metadata.Version
		}
		out = append(out, chartEntry{Name: n, Description: desc, Version: ver, AppVersion: appVer, Versions: len(versions), Keywords: keywords, Deprecated: deprecated})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

type ChartValuesRequest struct {
	Ref     string `json:"ref"`
	Version string `json:"version,omitempty"`
}

func (h *HelmManager) HandleChartValues(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ref, version := q.Get("ref"), q.Get("version")
	if ref == "" {
		http.Error(w, "ref required", http.StatusBadRequest)
		return
	}
	settings := h.settings()
	path, err := h.locateChart(ref, version, settings)
	if err != nil {
		http.Error(w, fmt.Sprintf("locate: %v", err), locateStatus(err))
		return
	}
	ch, err := loader.Load(path)
	if err != nil {
		http.Error(w, fmt.Sprintf("load: %v", err), http.StatusBadGateway)
		return
	}
	acc, err := chart.NewAccessor(ch)
	if err != nil {
		http.Error(w, fmt.Sprintf("load: %v", err), http.StatusBadGateway)
		return
	}
	out, err := yaml.Marshal(acc.Values())
	if err != nil {
		http.Error(w, "marshal: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	_, _ = w.Write(out)
}

// getters picks how Helm fetches one repository. An ordinary repository goes through
// the guarded transport, which refuses at connection time to reach a metadata or
// link-local address (or loopback in-cluster) whatever redirect or DNS answer got it
// there. Helm ignores a repository's own TLS settings when it is handed a transport,
// so a repository with a custom CA, client certificate or skip-verify keeps Helm's
// own; its URL has already been checked.
func (h *HelmManager) getters(settings *cli.EnvSettings, e *repo.Entry) getter.Providers {
	if e.CAFile != "" || e.CertFile != "" || e.KeyFile != "" || e.InsecureSkipTLSVerify {
		return getter.All(settings)
	}
	t := h.Outbound.Transport()
	return getter.Providers{{
		Schemes: []string{"http", "https"},
		New: func(opts ...getter.Option) (getter.Getter, error) {
			return getter.NewHTTPGetter(append(opts, getter.WithTransport(t))...)
		},
	}}
}
