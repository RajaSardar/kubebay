package fleet

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"k8s.io/client-go/rest"
)

// coldAPI is an in-process API server that answers metadata LISTs, paged, for
// the paths it is given ("/apis/apps/v1/deployments": "ns/name" entries), and
// a status code for the paths in fail. Every other path is a 404.
type coldAPI struct {
	srv       *httptest.Server
	mu        sync.Mutex
	objects   map[string][]string
	fail      map[string]int
	lists     map[string]int
	watches   atomic.Int32
	inFlight  atomic.Int32
	maxFlight atomic.Int32
	pageSize  int
	delay     time.Duration
	block     chan struct{}
	accept    atomic.Value
}

func newColdAPI(t *testing.T, objects map[string][]string) *coldAPI {
	t.Helper()
	f := &coldAPI{objects: objects, fail: map[string]int{}, lists: map[string]int{}, pageSize: 500}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := f.inFlight.Add(1)
		defer f.inFlight.Add(-1)
		for {
			m := f.maxFlight.Load()
			if n <= m || f.maxFlight.CompareAndSwap(m, n) {
				break
			}
		}
		if f.block != nil {
			select {
			case <-f.block:
			case <-r.Context().Done():
				return
			}
		}
		time.Sleep(f.delay)
		if r.URL.Query().Get("watch") == "true" {
			f.watches.Add(1)
			http.Error(w, "no watches", http.StatusBadRequest)
			return
		}
		f.accept.Store(r.Header.Get("Accept"))
		w.Header().Set("Content-Type", "application/json")
		f.mu.Lock()
		f.lists[r.URL.Path]++
		code, failing := f.fail[r.URL.Path]
		items, ok := f.objects[r.URL.Path]
		f.mu.Unlock()
		if failing {
			w.WriteHeader(code)
			reason := "Forbidden"
			switch code {
			case http.StatusUnauthorized:
				reason = "Unauthorized"
			case http.StatusServiceUnavailable:
				reason = "ServiceUnavailable"
			}
			_, _ = fmt.Fprintf(w, `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":%q,"code":%d,"message":"%s is forbidden: User \"alice\" cannot list resource"}`, reason, code, r.URL.Path)
			return
		}
		if !ok {
			http.NotFound(w, r)
			return
		}
		start := 0
		if c := r.URL.Query().Get("continue"); c != "" {
			_, _ = fmt.Sscanf(c, "%d", &start)
		}
		size := f.pageSize
		if l := r.URL.Query().Get("limit"); l != "" {
			var n int
			_, _ = fmt.Sscanf(l, "%d", &n)
			if n > 0 && n < size {
				size = n
			}
		}
		end := min(start+size, len(items))
		out := []map[string]any{}
		for _, it := range items[start:end] {
			ns, name, _ := strings.Cut(it, "/")
			md := map[string]any{"name": name}
			if ns != "" {
				md["namespace"] = ns
			}
			out = append(out, map[string]any{"kind": "PartialObjectMetadata", "apiVersion": "meta.k8s.io/v1", "metadata": md})
		}
		meta := map[string]any{}
		if end < len(items) {
			meta["continue"] = fmt.Sprintf("%d", end)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"kind": "PartialObjectMetadataList", "apiVersion": "meta.k8s.io/v1", "metadata": meta, "items": out})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *coldAPI) config() *rest.Config { return &rest.Config{Host: f.srv.URL} }

func (f *coldAPI) listCount(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lists[path]
}

func (f *coldAPI) totalLists() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.lists {
		n += c
	}
	return n
}

func clusterByID(r SearchResult) map[string]ClusterSearch {
	out := map[string]ClusterSearch{}
	for _, c := range r.Clusters {
		out[c.ID] = c
	}
	return out
}

const (
	deployPath = "/apis/apps/v1/deployments"
	podPath    = "/api/v1/pods"
	svcPath    = "/api/v1/services"
)

func TestColdSearchFindsNamesAcrossClustersRanked(t *testing.T) {
	a := newColdAPI(t, map[string][]string{deployPath: {"shop/api", "shop/web", "shop/api-gateway"}, podPath: {"shop/web-1"}})
	b := newColdAPI(t, map[string][]string{podPath: {"default/web-api-7f"}})
	s := NewSearcher(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config(), "b": b.config()})

	first := s.Search("", []string{"a", "b"}, "api", cfg)
	if c := clusterByID(first); !c["a"].Pending || !c["b"].Pending {
		t.Fatalf("first answer should be pending: %+v", first.Clusters)
	}
	s.Wait()
	got := s.Search("", []string{"a", "b"}, "api", cfg)
	for _, c := range got.Clusters {
		if c.Pending || c.Error != "" || c.CheckedAt == nil {
			t.Fatalf("cluster %s: %+v", c.ID, c)
		}
	}
	want := []ColdHit{
		{Cluster: "a", Slug: "deployments", Kind: "Deployments", NS: "shop", Name: "api", Score: 100},
		{Cluster: "a", Slug: "deployments", Kind: "Deployments", NS: "shop", Name: "api-gateway", Score: 90},
		{Cluster: "b", Slug: "pods", Kind: "Pods", NS: "default", Name: "web-api-7f", Score: 70},
	}
	if len(got.Hits) != len(want) || got.Total != 3 || got.Capped {
		t.Fatalf("hits: %+v (total %d)", got.Hits, got.Total)
	}
	for i := range want {
		if got.Hits[i] != want[i] {
			t.Errorf("hit %d: got %+v, want %+v", i, got.Hits[i], want[i])
		}
	}
	if clusterByID(got)["a"].Hits != 2 || clusterByID(got)["b"].Hits != 1 {
		t.Errorf("per-cluster counts: %+v", got.Clusters)
	}
	if a.watches.Load()+b.watches.Load() != 0 {
		t.Error("a cold search must not open a watch")
	}
	if acc, _ := a.accept.Load().(string); !strings.Contains(acc, "PartialObjectMetadataList") {
		t.Errorf("lists must ask for metadata only, Accept was %q", acc)
	}
	if len(got.Kinds) == 0 {
		t.Error("the answer must say which kinds it searched")
	}
}

func TestColdSearchKindWordListsOnlyThatKind(t *testing.T) {
	a := newColdAPI(t, map[string][]string{svcPath: {"shop/api", "shop/web"}, deployPath: {"shop/api"}})
	s := NewSearcher(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("", []string{"a"}, "svc api", cfg)
	s.Wait()
	got := s.Search("", []string{"a"}, "svc api", cfg)
	if len(got.Hits) != 1 || got.Hits[0].Slug != "services" || got.Hits[0].Kind != "Services" {
		t.Fatalf("hits: %+v", got.Hits)
	}
	if n := a.totalLists(); n != 1 || a.listCount(svcPath) != 1 {
		t.Fatalf("a named kind should list only that kind: %v", a.lists)
	}
	if len(got.Kinds) != 1 || got.Kinds[0] != "Services" {
		t.Errorf("kinds: %v", got.Kinds)
	}
}

func TestColdSearchKindWordAloneListsThatKind(t *testing.T) {
	a := newColdAPI(t, map[string][]string{svcPath: {"shop/b", "shop/a"}})
	s := NewSearcher(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("", []string{"a"}, "svc ", cfg)
	s.Wait()
	got := s.Search("", []string{"a"}, "svc ", cfg)
	if len(got.Hits) != 2 || got.Hits[0].Name != "a" {
		t.Fatalf("listing a kind sorts by name: %+v", got.Hits)
	}
}

func TestColdSearchCustomResourcesAreNotSearched(t *testing.T) {
	a := newColdAPI(t, map[string][]string{})
	s := NewSearcher(Options{})
	got := s.Search("", []string{"a"}, "crd certificates", cfgFor(map[string]*rest.Config{"a": a.config()}))
	s.Wait()
	if got.Unsupported == "" || len(got.Clusters) != 0 || a.totalLists() != 0 {
		t.Fatalf("a CRD query must say it isn't searched, and list nothing: %+v", got)
	}
}

func TestColdSearchEmptyQueryListsNothing(t *testing.T) {
	a := newColdAPI(t, map[string][]string{})
	s := NewSearcher(Options{})
	got := s.Search("", []string{"a"}, "   ", cfgFor(map[string]*rest.Config{"a": a.config()}))
	s.Wait()
	if len(got.Clusters) != 0 || len(got.Hits) != 0 || a.totalLists() != 0 {
		t.Fatalf("empty query: %+v", got)
	}
}

func TestColdSearchPagesAndTruncatesABigKind(t *testing.T) {
	var pods []string
	for i := 0; i < 25; i++ {
		pods = append(pods, fmt.Sprintf("ns/api-%02d", i))
	}
	a := newColdAPI(t, map[string][]string{podPath: pods})
	s := NewSearcher(Options{})
	s.pageSize, s.maxPages = 2, 10 // 20 of the 25 pods
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("", []string{"a"}, "pod api", cfg)
	s.Wait()
	got := s.Search("", []string{"a"}, "pod api", cfg)
	if got.Total != 20 {
		t.Fatalf("paged list should hold 20 pods, got %d", got.Total)
	}
	if c := clusterByID(got)["a"]; len(c.Truncated) != 1 || c.Truncated[0] != "Pods" {
		t.Fatalf("truncated kind must be named: %+v", c)
	}
	if n := a.listCount(podPath); n != 10 {
		t.Errorf("%d pages listed, cap is 10", n)
	}
}

func TestColdSearchForbiddenKindIsANoteNotAnError(t *testing.T) {
	a := newColdAPI(t, map[string][]string{podPath: {"shop/api-1"}, deployPath: {"shop/api"}})
	a.fail[deployPath] = http.StatusForbidden
	s := NewSearcher(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("", []string{"a"}, "api", cfg)
	s.Wait()
	got := s.Search("", []string{"a"}, "api", cfg)
	c := clusterByID(got)["a"]
	if c.Error != "" || c.Pending {
		t.Fatalf("a forbidden kind is not a cluster error: %+v", c)
	}
	if len(c.Denied) != 1 || c.Denied[0].Label != "Deployments" || !strings.Contains(c.Denied[0].Reason, "forbidden") {
		t.Fatalf("denied: %+v", c.Denied)
	}
	if len(got.Hits) != 1 || got.Hits[0].Slug != "pods" {
		t.Fatalf("other kinds still searched: %+v", got.Hits)
	}
}

func TestColdSearchUnreachableClusterIsAClusterNote(t *testing.T) {
	s := NewSearcher(Options{Timeout: 2 * time.Second})
	cfg := cfgFor(map[string]*rest.Config{"down": {Host: "http://127.0.0.1:1"}})
	s.Search("", []string{"down", "broken"}, "api", cfg)
	s.Wait()
	got := clusterByID(s.Search("", []string{"down", "broken"}, "api", cfg))
	if got["down"].Error == "" || got["down"].Pending {
		t.Fatalf("down: %+v", got["down"])
	}
	if got["broken"].Error == "" || got["broken"].Pending {
		t.Fatalf("misconfigured: %+v", got["broken"])
	}
}

func TestColdSearchUnreachableIsNotRetriedWithinTTL(t *testing.T) {
	a := newColdAPI(t, map[string][]string{})
	a.fail[podPath] = http.StatusServiceUnavailable
	s := NewSearcher(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("", []string{"a"}, "pod api", cfg)
	s.Wait()
	before := a.totalLists()
	got := s.Search("", []string{"a"}, "pod api", cfg)
	s.Wait()
	if c := clusterByID(got)["a"]; c.Error == "" || c.Pending {
		t.Fatalf("a failed cluster reports its error: %+v", c)
	}
	if a.totalLists() != before {
		t.Errorf("failed cluster retried inside the TTL: %d lists, was %d", a.totalLists(), before)
	}
}

func TestColdSearchCachesNamesForTTLAcrossQueries(t *testing.T) {
	a := newColdAPI(t, map[string][]string{deployPath: {"shop/api", "shop/web"}})
	now := time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	s := NewSearcher(Options{TTL: time.Minute, Now: func() time.Time { mu.Lock(); defer mu.Unlock(); return now }})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("", []string{"a"}, "deploy api", cfg)
	s.Wait()
	// Another query over the same kind is answered from the cache.
	if got := s.Search("", []string{"a"}, "deploy web", cfg); len(got.Hits) != 1 || got.Hits[0].Name != "web" || clusterByID(got)["a"].Pending {
		t.Fatalf("cached answer: %+v", got)
	}
	s.Wait()
	if n := a.listCount(deployPath); n != 1 {
		t.Fatalf("fresh cache relisted: %d lists", n)
	}
	mu.Lock()
	now = now.Add(61 * time.Second)
	mu.Unlock()
	got := s.Search("", []string{"a"}, "deploy web", cfg)
	if !clusterByID(got)["a"].Pending || len(got.Hits) != 1 {
		t.Fatalf("stale names are served while they refresh: %+v", got)
	}
	s.Wait()
	if n := a.listCount(deployPath); n != 2 {
		t.Fatalf("stale cache not relisted: %d lists", n)
	}
}

func TestColdSearchConcurrencyIsCapped(t *testing.T) {
	api := newColdAPI(t, map[string][]string{podPath: {"ns/api"}})
	api.delay = 20 * time.Millisecond
	cfgs := map[string]*rest.Config{}
	var ids []string
	for i := 0; i < 15; i++ {
		id := fmt.Sprintf("c%d", i)
		ids = append(ids, id)
		cfgs[id] = api.config()
	}
	s := NewSearcher(Options{Concurrency: 3})
	s.Search("", ids, "pod api", cfgFor(cfgs))
	s.Wait()
	if m := api.maxFlight.Load(); m > 3 {
		t.Fatalf("%d lists in flight, cap is 3", m)
	}
	if got := s.Search("", ids, "pod api", cfgFor(cfgs)); got.Total != 15 {
		t.Fatalf("every cluster searched: %d hits", got.Total)
	}
}

func TestColdSearchHitsAreCapped(t *testing.T) {
	var pods []string
	for i := 0; i < MaxHits+40; i++ {
		pods = append(pods, fmt.Sprintf("ns/api-%03d", i))
	}
	a := newColdAPI(t, map[string][]string{podPath: pods})
	s := NewSearcher(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("", []string{"a"}, "pod api", cfg)
	s.Wait()
	got := s.Search("", []string{"a"}, "pod api", cfg)
	if len(got.Hits) != MaxHits || got.Total != MaxHits+40 || !got.Capped {
		t.Fatalf("hits %d total %d capped %v", len(got.Hits), got.Total, got.Capped)
	}
}

func TestColdSearchRequestIsCappedAndDeduplicated(t *testing.T) {
	cfgs := map[string]*rest.Config{}
	var ids []string
	for i := 0; i < MaxPerRequest+50; i++ {
		id := fmt.Sprintf("c%d", i)
		ids = append(ids, id, id)
		cfgs[id] = &rest.Config{Host: "http://127.0.0.1:1"}
	}
	s := NewSearcher(Options{Timeout: 200 * time.Millisecond})
	got := s.Search("", ids, "pod api", cfgFor(cfgs))
	if len(got.Clusters) != MaxPerRequest {
		t.Fatalf("got %d clusters, cap is %d", len(got.Clusters), MaxPerRequest)
	}
	s.Wait()
}

func TestColdSearchHungClusterTimesOut(t *testing.T) {
	a := newColdAPI(t, map[string][]string{podPath: {"ns/api"}})
	a.block = make(chan struct{})
	defer close(a.block)
	s := NewSearcher(Options{Timeout: 150 * time.Millisecond})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("", []string{"a"}, "pod api", cfg)
	s.Wait()
	got := clusterByID(s.Search("", []string{"a"}, "pod api", nil))["a"]
	if got.Pending || !strings.Contains(got.Error, "timed out") {
		t.Fatalf("hung cluster: %+v", got)
	}
}

func TestColdSearchScopesAreCachedSeparately(t *testing.T) {
	a := newColdAPI(t, map[string][]string{podPath: {"ns/api"}})
	s := NewSearcher(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": a.config()})
	s.Search("alice", []string{"a"}, "pod api", cfg)
	s.Wait()
	if got := s.Search("bob", []string{"a"}, "pod api", cfg); !clusterByID(got)["a"].Pending || len(got.Hits) != 0 {
		t.Fatalf("bob must not see alice's results: %+v", got)
	}
	s.Wait()
}
