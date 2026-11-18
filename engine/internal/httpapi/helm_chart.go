package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/chart/loader"
	chartv2 "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/cli"
	"helm.sh/helm/v4/pkg/downloader"
	repo "helm.sh/helm/v4/pkg/repo/v1"
)

// errChartRefused marks a chart archive the engine would not fetch.
var errChartRefused = errors.New("chart not fetched")

func locateStatus(err error) int {
	if errors.Is(err, errChartRefused) {
		return http.StatusBadRequest
	}
	return http.StatusBadGateway
}

// locateChart fetches a chart and returns where it landed. A chart named
// "repo/name" in a repository you added goes through the same guarded transport
// as the repository's index, and the archive URL the index names is checked
// first: an index is its repository's say-so and may point anywhere. Anything
// else (a local path, an OCI or full URL) is left to Helm.
func (h *HelmManager) locateChart(ref, version string, settings *cli.EnvSettings) (string, error) {
	cpo := action.ChartPathOptions{Version: version}
	repoName, _, ok := strings.Cut(ref, "/")
	if !ok {
		return cpo.LocateChart(ref, settings)
	}
	if _, err := os.Stat(ref); err == nil {
		return cpo.LocateChart(ref, settings)
	}
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		return cpo.LocateChart(ref, settings)
	}
	entry := f.Get(repoName)
	if entry == nil {
		return cpo.LocateChart(ref, settings)
	}
	dl := downloader.ChartDownloader{
		Out:              io.Discard,
		Getters:          h.getters(settings, entry),
		RepositoryConfig: settings.RepositoryConfig,
		RepositoryCache:  settings.RepositoryCache,
		ContentCache:     settings.ContentCache,
	}
	_, u, err := dl.ResolveChartVersion(ref, version)
	if err != nil {
		return "", err
	}
	if verr := h.Outbound.ValidateURL(u.String()); verr != nil {
		return "", fmt.Errorf("%w: %s: %v", errChartRefused, u.Redacted(), verr)
	}
	if err := os.MkdirAll(settings.RepositoryCache, 0o755); err != nil {
		return "", err
	}
	path, _, err := dl.DownloadToCache(ref, version)
	return path, err
}

type ChartMaintainer struct {
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
	URL   string `json:"url,omitempty"`
}

// ChartVersion is one version in a repository's index.
type ChartVersion struct {
	Version    string `json:"version"`
	AppVersion string `json:"appVersion,omitempty"`
	Created    string `json:"created,omitempty"`
	Deprecated bool   `json:"deprecated,omitempty"`
}

// ChartDetail is a chart's page in the store: what its repository's index says of
// every version, and what one version's archive says of itself.
type ChartDetail struct {
	Name        string            `json:"name"`
	Repo        string            `json:"repo"`
	Version     string            `json:"version"`
	AppVersion  string            `json:"appVersion,omitempty"`
	Description string            `json:"description,omitempty"`
	Home        string            `json:"home,omitempty"`
	Deprecated  bool              `json:"deprecated,omitempty"`
	Keywords    []string          `json:"keywords,omitempty"`
	Sources     []string          `json:"sources,omitempty"`
	Maintainers []ChartMaintainer `json:"maintainers,omitempty"`
	Readme      string            `json:"readme,omitempty"`
	Versions    []ChartVersion    `json:"versions"`
}

// maxReadme caps a README the engine sends; a chart's own is rarely a tenth of it.
const maxReadme = 256 << 10

// HandleChart serves one chart's detail from a configured repository.
func (h *HelmManager) HandleChart(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	repoName, name, version := q.Get("repo"), q.Get("name"), q.Get("version")
	if repoName == "" || name == "" {
		http.Error(w, "repo and name required", http.StatusBadRequest)
		return
	}
	settings := h.settings()
	f, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil || f.Get(repoName) == nil {
		http.Error(w, fmt.Sprintf("no repository named %q", repoName), http.StatusNotFound)
		return
	}
	idx, err := repo.LoadIndexFile(filepath.Join(settings.RepositoryCache, repoName+"-index.yaml"))
	if err != nil {
		http.Error(w, fmt.Sprintf("index for %q not cached — update repos first", repoName), http.StatusNotFound)
		return
	}
	entries := idx.Entries[name]
	if len(entries) == 0 {
		http.Error(w, fmt.Sprintf("no chart %q in %q", name, repoName), http.StatusNotFound)
		return
	}
	out := ChartDetail{Name: name, Repo: repoName, Versions: []ChartVersion{}}
	for _, e := range entries {
		if e.Metadata == nil {
			continue
		}
		v := ChartVersion{Version: e.Metadata.Version, AppVersion: e.Metadata.AppVersion, Deprecated: e.Metadata.Deprecated}
		if !e.Created.IsZero() {
			v.Created = e.Created.UTC().Format("2006-01-02")
		}
		out.Versions = append(out.Versions, v)
	}

	path, err := h.locateChart(repoName+"/"+name, version, settings)
	if err != nil {
		http.Error(w, fmt.Sprintf("locate: %v", err), locateStatus(err))
		return
	}
	ch, err := loader.Load(path)
	if err != nil {
		http.Error(w, fmt.Sprintf("load: %v", err), http.StatusBadGateway)
		return
	}
	c, ok := ch.(*chartv2.Chart)
	if !ok || c.Metadata == nil {
		http.Error(w, "unsupported chart format", http.StatusBadGateway)
		return
	}
	m := c.Metadata
	out.Version, out.AppVersion, out.Description = m.Version, m.AppVersion, m.Description
	out.Home, out.Deprecated = m.Home, m.Deprecated
	out.Keywords, out.Sources = m.Keywords, m.Sources
	for _, mt := range m.Maintainers {
		if mt != nil {
			out.Maintainers = append(out.Maintainers, ChartMaintainer{Name: mt.Name, Email: mt.Email, URL: mt.URL})
		}
	}
	for _, file := range c.Files {
		if strings.EqualFold(file.Name, "README.md") || strings.EqualFold(file.Name, "README") {
			data := file.Data
			if len(data) > maxReadme {
				data = data[:maxReadme]
			}
			out.Readme = string(data)
			break
		}
	}
	writeJSON(w, out)
}
