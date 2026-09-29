package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"

	"sigs.k8s.io/yaml"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/repo"
)

type RepoSummary struct {
	Name string `json:"name"`
	URL  string `json:"url"`
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
		out = append(out, RepoSummary{Name: e.Name, URL: e.URL})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *HelmManager) HandleUpdateRepos(w http.ResponseWriter, r *http.Request) {
	settings := h.settings()
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		http.Error(w, "no repositories configured (run: helm repo add …)", http.StatusBadRequest)
		return
	}
	getters := getter.All(settings)
	type result struct {
		name string
		msg  string
	}
	done := make(chan result, len(f.Repositories))
	for _, entry := range f.Repositories {
		go func(e *repo.Entry) {
			cr, cerr := repo.NewChartRepository(e, getters)
			if cerr != nil {
				done <- result{e.Name, "error: " + cerr.Error()}
				return
			}
			cr.CachePath = settings.RepositoryCache
			if _, derr := cr.DownloadIndexFile(); derr != nil {
				done <- result{e.Name, "error: " + derr.Error()}
				return
			}
			done <- result{e.Name, "ok"}
		}(entry)
	}
	results := map[string]string{}
	for range f.Repositories {
		res := <-done
		results[res.name] = res.msg
	}
	writeJSON(w, results)
}

// addOrUpdateRepoEntry adds a new repo entry to f, or updates an existing
// one's URL in place, returning whether the file actually changed so the
// caller only needs to persist it to disk when something moved.
func addOrUpdateRepoEntry(f *repo.File, name, url string) (*repo.Entry, bool) {
	if existing := f.Get(name); existing != nil {
		if existing.URL == url {
			return existing, false
		}
		existing.URL = url
		return existing, true
	}
	entry := &repo.Entry{Name: name, URL: url}
	f.Add(entry)
	return entry, true
}

type AddRepoRequest struct {
	Name string `json:"name"`
	URL  string `json:"url"`
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

	settings := h.settings()
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		if !os.IsNotExist(err) {
			http.Error(w, fmt.Sprintf("load repo file: %v", err), http.StatusInternalServerError)
			return
		}
		f = repo.NewFile()
	}

	entry, changed := addOrUpdateRepoEntry(f, req.Name, req.URL)

	getters := getter.All(settings)
	cr, cerr := repo.NewChartRepository(entry, getters)
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
		if err := os.MkdirAll(filepath.Dir(settings.RepositoryConfig), 0755); err != nil {
			http.Error(w, fmt.Sprintf("mkdir: %v", err), http.StatusInternalServerError)
			return
		}
		if err := f.WriteFile(settings.RepositoryConfig, 0644); err != nil {
			http.Error(w, fmt.Sprintf("write repo file: %v", err), http.StatusInternalServerError)
			return
		}
	}

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
		Name        string `json:"name"`
		Description string `json:"description"`
		Version     string `json:"version"`
		AppVersion  string `json:"appVersion,omitempty"`
		Versions    int    `json:"versions"`
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
		if latest.Metadata != nil {
			desc = latest.Metadata.Description
			appVer = latest.Metadata.AppVersion
			ver = latest.Metadata.Version
		}
		out = append(out, chartEntry{Name: n, Description: desc, Version: ver, AppVersion: appVer, Versions: len(versions)})
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
	cpo := action.ChartPathOptions{Version: version}
	path, err := cpo.LocateChart(ref, settings)
	if err != nil {
		http.Error(w, fmt.Sprintf("locate: %v", err), http.StatusBadGateway)
		return
	}
	ch, err := loader.Load(path)
	if err != nil {
		http.Error(w, fmt.Sprintf("load: %v", err), http.StatusBadGateway)
		return
	}
	out, err := yaml.Marshal(ch.Values)
	if err != nil {
		http.Error(w, "marshal: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	_, _ = w.Write(out)
}
