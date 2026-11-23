package fleet

import (
	"encoding/json"
	"errors"
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

// fakeAPI is an in-process API server answering /version and a paged
// /api/v1/nodes. ready lists which of the nodes report Ready=True.
type fakeAPI struct {
	srv       *httptest.Server
	nodeLists atomic.Int32
	other     atomic.Int32
	inFlight  atomic.Int32
	maxFlight atomic.Int32
	delay     time.Duration
	block     chan struct{}
}

func newFakeAPI(t *testing.T, ready []bool, pageSize int) *fakeAPI {
	t.Helper()
	f := &fakeAPI{}
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
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/version":
			_, _ = w.Write([]byte(`{"major":"1","minor":"31","gitVersion":"v1.31.2"}`))
		case "/api/v1/nodes":
			f.nodeLists.Add(1)
			start := 0
			if c := r.URL.Query().Get("continue"); c != "" {
				_, _ = fmt.Sscanf(c, "%d", &start)
			}
			end := min(start+pageSize, len(ready))
			items := []map[string]any{}
			for i := start; i < end; i++ {
				st := "False"
				if ready[i] {
					st = "True"
				}
				items = append(items, map[string]any{
					"metadata": map[string]any{"name": fmt.Sprintf("n%d", i)},
					"status":   map[string]any{"conditions": []map[string]any{{"type": "Ready", "status": st}}},
				})
			}
			meta := map[string]any{}
			if end < len(ready) {
				meta["continue"] = fmt.Sprintf("%d", end)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"kind": "NodeList", "apiVersion": "v1", "metadata": meta, "items": items})
		default:
			f.other.Add(1)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeAPI) config() *rest.Config { return &rest.Config{Host: f.srv.URL} }

func cfgFor(cfgs map[string]*rest.Config) ConfigFunc {
	return func(id string) (*rest.Config, error) {
		c, ok := cfgs[id]
		if !ok {
			return nil, errors.New("unknown cluster " + id)
		}
		return c, nil
	}
}

func byID(sums []Summary) map[string]Summary {
	out := map[string]Summary{}
	for _, s := range sums {
		out[s.ID] = s
	}
	return out
}

func TestSummaryCountsNodesAndReadyAcrossPages(t *testing.T) {
	api := newFakeAPI(t, []bool{true, true, false, true, true}, 2)
	s := New(Options{})
	s.Get("", []string{"a"}, cfgFor(map[string]*rest.Config{"a": api.config()}))
	s.Wait()
	got := byID(s.Get("", []string{"a"}, nil))["a"]
	if got.Pending || got.Status != StatusReachable || got.Version != "v1.31.2" {
		t.Fatalf("summary: %+v", got)
	}
	if got.Nodes == nil || *got.Nodes != 5 || got.ReadyNodes == nil || *got.ReadyNodes != 4 {
		t.Fatalf("nodes: %+v", got)
	}
	if got.CheckedAt == nil {
		t.Error("checkedAt missing")
	}
	if api.other.Load() != 0 {
		t.Errorf("summary made %d calls beyond /version and nodes", api.other.Load())
	}
}

func TestFirstRequestIsPendingAndDoesNotBlock(t *testing.T) {
	api := newFakeAPI(t, []bool{true}, 10)
	api.block = make(chan struct{})
	s := New(Options{})
	start := time.Now()
	got := byID(s.Get("", []string{"a"}, cfgFor(map[string]*rest.Config{"a": api.config()})))["a"]
	if time.Since(start) > time.Second {
		t.Fatal("Get blocked on the network")
	}
	if !got.Pending {
		t.Fatalf("first request should be pending: %+v", got)
	}
	close(api.block)
	s.Wait()
}

func TestCachedForTTLThenRefetched(t *testing.T) {
	api := newFakeAPI(t, []bool{true}, 10)
	now := time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	s := New(Options{TTL: time.Minute, Now: func() time.Time { mu.Lock(); defer mu.Unlock(); return now }})
	cfg := cfgFor(map[string]*rest.Config{"a": api.config()})
	s.Get("", []string{"a"}, cfg)
	s.Wait()
	s.Get("", []string{"a"}, cfg)
	s.Wait()
	if n := api.nodeLists.Load(); n != 1 {
		t.Fatalf("fresh summary refetched: %d node lists", n)
	}
	mu.Lock()
	now = now.Add(61 * time.Second)
	mu.Unlock()
	got := byID(s.Get("", []string{"a"}, cfg))["a"]
	if !got.Pending || got.Nodes == nil {
		t.Fatalf("stale summary should be returned while refreshing: %+v", got)
	}
	s.Wait()
	if n := api.nodeLists.Load(); n != 2 {
		t.Fatalf("stale summary not refetched: %d node lists", n)
	}
}

func TestConcurrencyIsCapped(t *testing.T) {
	api := newFakeAPI(t, []bool{true}, 10)
	api.delay = 30 * time.Millisecond
	cfgs := map[string]*rest.Config{}
	var ids []string
	for i := 0; i < 15; i++ {
		id := fmt.Sprintf("c%d", i)
		ids = append(ids, id)
		cfgs[id] = api.config()
	}
	s := New(Options{Concurrency: 3})
	s.Get("", ids, cfgFor(cfgs))
	s.Wait()
	if m := api.maxFlight.Load(); m > 3 {
		t.Fatalf("%d requests in flight, cap is 3", m)
	}
	for _, sum := range s.Get("", ids, nil) {
		if sum.Pending || sum.Status != StatusReachable {
			t.Fatalf("%s: %+v", sum.ID, sum)
		}
	}
}

func TestRequestIsCappedAndDeduplicated(t *testing.T) {
	cfgs := map[string]*rest.Config{}
	var ids []string
	for i := 0; i < MaxPerRequest+50; i++ {
		id := fmt.Sprintf("c%d", i)
		ids = append(ids, id, id)
		cfgs[id] = &rest.Config{Host: "http://127.0.0.1:1"}
	}
	s := New(Options{Timeout: 200 * time.Millisecond})
	got := s.Get("", ids, cfgFor(cfgs))
	if len(got) != MaxPerRequest {
		t.Fatalf("got %d summaries, cap is %d", len(got), MaxPerRequest)
	}
	s.Wait()
}

func TestHungClusterTimesOut(t *testing.T) {
	api := newFakeAPI(t, []bool{true}, 10)
	api.block = make(chan struct{})
	defer close(api.block)
	s := New(Options{Timeout: 150 * time.Millisecond})
	s.Get("", []string{"a"}, cfgFor(map[string]*rest.Config{"a": api.config()}))
	s.Wait()
	got := byID(s.Get("", []string{"a"}, nil))["a"]
	if got.Status != StatusUnreachable || !strings.Contains(got.Error, "timed out") {
		t.Fatalf("hung cluster: %+v", got)
	}
}

func TestUnreachableAndMisconfigured(t *testing.T) {
	s := New(Options{Timeout: 2 * time.Second})
	cfg := cfgFor(map[string]*rest.Config{"down": {Host: "http://127.0.0.1:1"}})
	s.Get("", []string{"down", "broken"}, cfg)
	s.Wait()
	got := byID(s.Get("", []string{"down", "broken"}, cfg))
	if got["down"].Status != StatusUnreachable || got["down"].Error == "" || got["down"].Nodes != nil {
		t.Fatalf("down: %+v", got["down"])
	}
	if got["broken"].Status != StatusMisconfigured || got["broken"].Pending {
		t.Fatalf("broken: %+v", got["broken"])
	}
}

func TestNodesForbiddenKeepsVersion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/version" {
			_, _ = w.Write([]byte(`{"gitVersion":"v1.30.0"}`))
			return
		}
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403,"message":"nodes is forbidden"}`))
	}))
	defer srv.Close()
	s := New(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": {Host: srv.URL}})
	s.Get("", []string{"a"}, cfg)
	s.Wait()
	got := byID(s.Get("", []string{"a"}, cfg))["a"]
	if got.Status != StatusReachable || got.Version != "v1.30.0" || got.Nodes != nil || !strings.Contains(got.Error, "forbidden") {
		t.Fatalf("forbidden nodes: %+v", got)
	}
}

func TestScopesAreCachedSeparately(t *testing.T) {
	api := newFakeAPI(t, []bool{true}, 10)
	s := New(Options{})
	cfg := cfgFor(map[string]*rest.Config{"a": api.config()})
	s.Get("alice", []string{"a"}, cfg)
	s.Wait()
	if got := byID(s.Get("bob", []string{"a"}, cfg))["a"]; !got.Pending {
		t.Fatalf("bob must not see alice's summary: %+v", got)
	}
	s.Wait()
}
