package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"helm.sh/helm/v4/pkg/chart/common"
	chartv2 "helm.sh/helm/v4/pkg/chart/v2"
	chartutil "helm.sh/helm/v4/pkg/chart/v2/util"

	"github.com/RajaSardar/kubebay/engine/internal/netguard"
)

// storeRepo is a Helm repository on a local server holding one chart, "web", in
// two versions, with Helm's repo config and caches pointed at a temp dir.
// archiveHost, when set, is where the index says the chart archives live.
func storeRepo(t *testing.T, archiveHost string) *atomic.Int32 {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HELM_REPOSITORY_CONFIG", filepath.Join(dir, "repositories.yaml"))
	t.Setenv("HELM_REPOSITORY_CACHE", filepath.Join(dir, "cache"))
	t.Setenv("HELM_CONTENT_CACHE", filepath.Join(dir, "content"))
	t.Setenv("HELM_CONFIG_HOME", dir)
	t.Setenv("HELM_CACHE_HOME", dir)
	t.Setenv("HELM_DATA_HOME", dir)

	archiveHits := &atomic.Int32{}
	archives := map[string][]byte{}
	digests := map[string]string{}
	pack := t.TempDir()
	for _, v := range []string{"1.0.0", "2.0.0"} {
		c := &chartv2.Chart{
			Metadata: &chartv2.Metadata{
				APIVersion: "v2", Name: "web", Version: v, AppVersion: "app-" + v,
				Description: "A web chart", Home: "https://example.com/web",
				Keywords:    []string{"web", "http"},
				Sources:     []string{"https://example.com/src"},
				Maintainers: []*chartv2.Maintainer{{Name: "Ada", Email: "ada@example.com"}},
			},
			Files:  []*common.File{{Name: "README.md", Data: []byte("# web " + v + "\nHello store.")}},
			Values: map[string]any{"replicas": 1},
		}
		p, err := chartutil.Save(c, pack)
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(b)
		archives["/web-"+v+".tgz"] = b
		digests[v] = hex.EncodeToString(sum[:])
	}
	var base string
	index := func() string {
		host := archiveHost
		if host == "" {
			host = base
		}
		return fmt.Sprintf(`apiVersion: v1
entries:
  web:
  - {apiVersion: v2, name: web, version: 2.0.0, appVersion: app-2.0.0, description: A web chart, home: "https://example.com/web", keywords: [web, http], maintainers: [{name: Ada, email: ada@example.com}], digest: %s, created: "2026-02-01T00:00:00Z", urls: ["%s/web-2.0.0.tgz"]}
  - {apiVersion: v2, name: web, version: 1.0.0, appVersion: app-1.0.0, description: A web chart, deprecated: true, digest: %s, created: "2026-01-01T00:00:00Z", urls: ["%s/web-1.0.0.tgz"]}
generated: "2026-02-01T00:00:00Z"
`, digests["2.0.0"], host, digests["1.0.0"], host)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/index.yaml" {
			_, _ = io.WriteString(w, index())
			return
		}
		if b, ok := archives[r.URL.Path]; ok {
			archiveHits.Add(1)
			_, _ = w.Write(b)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	base = srv.URL

	cfg := "apiVersion: \"\"\ngenerated: \"0001-01-01T00:00:00Z\"\nrepositories:\n- name: store\n  url: " + srv.URL + "\n"
	if err := os.WriteFile(filepath.Join(dir, "repositories.yaml"), []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "cache"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cache", "store-index.yaml"), []byte(index()), 0o644); err != nil {
		t.Fatal(err)
	}
	return archiveHits
}

func getChart(h *HelmManager, q string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.HandleChart(rec, httptest.NewRequest(http.MethodGet, "/api/helm/chart?"+q, nil))
	return rec
}

// A chart's page in the store lists its versions from the repo index, and
// shows the chosen version's README, maintainers and links.
func TestHandleChartDetailsAVersionAndListsTheOthers(t *testing.T) {
	storeRepo(t, "")
	rec := getChart(&HelmManager{}, url.Values{"repo": {"store"}, "name": {"web"}, "version": {"1.0.0"}}.Encode())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var d ChartDetail
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	if d.Version != "1.0.0" || d.AppVersion != "app-1.0.0" {
		t.Errorf("version = %q app %q", d.Version, d.AppVersion)
	}
	if !strings.Contains(d.Readme, "Hello store.") {
		t.Errorf("readme = %q", d.Readme)
	}
	if len(d.Maintainers) != 1 || d.Maintainers[0].Name != "Ada" || d.Maintainers[0].Email != "ada@example.com" {
		t.Errorf("maintainers = %+v", d.Maintainers)
	}
	if d.Home != "https://example.com/web" || len(d.Sources) != 1 || len(d.Keywords) != 2 {
		t.Errorf("links = %q %v %v", d.Home, d.Sources, d.Keywords)
	}
	if len(d.Versions) != 2 || d.Versions[0].Version != "2.0.0" || d.Versions[1].Version != "1.0.0" || !d.Versions[1].Deprecated {
		t.Errorf("versions = %+v", d.Versions)
	}
}

// With no version asked for, the newest is detailed.
func TestHandleChartDefaultsToTheNewestVersion(t *testing.T) {
	storeRepo(t, "")
	rec := getChart(&HelmManager{}, "repo=store&name=web")
	var d ChartDetail
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil || d.Version != "2.0.0" {
		t.Fatalf("status %d version %q err %v: %s", rec.Code, d.Version, err, rec.Body)
	}
}

func TestHandleChartNeedsARepoAndAName(t *testing.T) {
	for _, q := range []string{"", "repo=store", "name=web"} {
		if rec := getChart(&HelmManager{}, q); rec.Code != http.StatusBadRequest {
			t.Errorf("%q: status %d, want 400", q, rec.Code)
		}
	}
}

func TestHandleChartUnknownRepoIs404(t *testing.T) {
	storeRepo(t, "")
	if rec := getChart(&HelmManager{}, "repo=nope&name=web"); rec.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404: %s", rec.Code, rec.Body)
	}
}

// A repo index is the repo's say-so: it can name any URL for a chart archive.
// The engine must not fetch one it would refuse as a repo URL.
func TestHandleChartRefusesAnArchiveAtAMetadataAddress(t *testing.T) {
	storeRepo(t, "http://169.254.169.254")
	rec := getChart(&HelmManager{}, "repo=store&name=web&version=2.0.0")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "link-local") {
		t.Errorf("status %d body %q, want 400 naming the link-local address", rec.Code, rec.Body)
	}
}

func TestHandleChartRefusesALoopbackArchiveInCluster(t *testing.T) {
	hits := storeRepo(t, "")
	h := &HelmManager{Outbound: netguard.Policy{BlockLoopback: true}}
	rec := getChart(h, "repo=store&name=web&version=2.0.0")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400: %s", rec.Code, rec.Body)
	}
	if hits.Load() != 0 {
		t.Errorf("the archive was fetched %d times", hits.Load())
	}
}

// The chart list marks deprecated charts and carries keywords, so the store can
// filter on them.
func TestHandleChartsCarriesKeywordsAndDeprecation(t *testing.T) {
	storeRepo(t, "")
	rec := httptest.NewRecorder()
	(&HelmManager{}).HandleCharts(rec, httptest.NewRequest(http.MethodGet, "/api/helm/charts?repo=store", nil))
	var out []struct {
		Name       string   `json:"name"`
		Keywords   []string `json:"keywords"`
		Deprecated bool     `json:"deprecated"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out) != 1 {
		t.Fatalf("err %v body %s", err, rec.Body)
	}
	if len(out[0].Keywords) != 2 || out[0].Deprecated {
		t.Errorf("entry = %+v", out[0])
	}
}
