package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/searchindex"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

type sFakeSub struct {
	snap   chan stream.Snapshot
	deltas chan []stream.Op
	ctx    context.Context
}

func (f *sFakeSub) Snapshot() <-chan stream.Snapshot { return f.snap }
func (f *sFakeSub) Deltas() <-chan []stream.Op       { return f.deltas }
func (f *sFakeSub) CloseReason() string              { return "" }

type sFakePool struct {
	mu     sync.Mutex
	subs   map[string]*sFakeSub
	counts map[string]int
	closed bool
}

func newSPool() *sFakePool { return &sFakePool{subs: map[string]*sFakeSub{}, counts: map[string]int{}} }

func (p *sFakePool) Subscribe(ctx context.Context, gvr string, _ []string, _, _ string) (searchindex.Sub, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.counts[gvr]++
	s := &sFakeSub{snap: make(chan stream.Snapshot, 1), deltas: make(chan []stream.Op, 4), ctx: ctx}
	p.subs[gvr] = s
	return s, nil
}
func (p *sFakePool) Closed() bool { p.mu.Lock(); defer p.mu.Unlock(); return p.closed }
func (p *sFakePool) Key() any     { return p }
func (p *sFakePool) sub(gvr string) *sFakeSub {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.subs[gvr]
}
func (p *sFakePool) count(gvr string) int { p.mu.Lock(); defer p.mu.Unlock(); return p.counts[gvr] }

type sFakeBackend struct {
	mu         sync.Mutex
	pool       *sFakePool
	connectErr error
	crds       []searchindex.CRD
	crdErr     error
}

func (b *sFakeBackend) Connect(string) error { return b.connectErr }
func (b *sFakeBackend) Pool(context.Context, string) (SearchPool, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.pool, nil
}
func (b *sFakeBackend) ListCRDs(context.Context, string) ([]searchindex.CRD, error) {
	return b.crds, b.crdErr
}
func (b *sFakeBackend) swapPool(p *sFakePool) { b.mu.Lock(); b.pool = p; b.mu.Unlock() }

func sObj(ns, name string) stream.Op {
	meta := map[string]any{"name": name}
	if ns != "" {
		meta["namespace"] = ns
	}
	return stream.Op{Op: stream.OpAdd, Key: ns + "/" + name, Obj: map[string]any{"metadata": meta}}
}

func doSearch(t *testing.T, a *SearchAPI, query string) (int, searchindex.Result) {
	t.Helper()
	rr := httptest.NewRecorder()
	a.HandleSearch(rr, httptest.NewRequest(http.MethodGet, "/api/search?"+query, nil))
	var res searchindex.Result
	_ = json.Unmarshal(rr.Body.Bytes(), &res)
	return rr.Code, res
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func group(r searchindex.Result, slug string) *searchindex.Group {
	for i := range r.Groups {
		if r.Groups[i].Slug == slug {
			return &r.Groups[i]
		}
	}
	return nil
}

func TestSearchNeedsAClusterAndAQuery(t *testing.T) {
	a := NewSearchAPI(&sFakeBackend{pool: newSPool()})
	defer a.Close()
	if code, _ := doSearch(t, a, "q=api"); code != http.StatusBadRequest {
		t.Errorf("no cluster: %d", code)
	}
	if code, _ := doSearch(t, a, "cluster=c1"); code != http.StatusBadRequest {
		t.Errorf("no query: %d", code)
	}
	long := make([]byte, 600)
	for i := range long {
		long[i] = 'a'
	}
	if code, _ := doSearch(t, a, "cluster=c1&q="+string(long)); code != http.StatusBadRequest {
		t.Errorf("a very long query: %d", code)
	}
}

func TestSearchAnswersFromTheObjectsTheClusterHolds(t *testing.T) {
	pool := newSPool()
	a := NewSearchAPI(&sFakeBackend{pool: pool})
	defer a.Close()
	code, first := doSearch(t, a, "cluster=c1&q=api")
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if len(first.Pending) == 0 {
		t.Error("the first answer comes before anything has listed, and must say so")
	}
	waitFor(t, "the services subscription", func() bool { return pool.sub("v1/services") != nil })
	pool.sub("v1/services").snap <- stream.OpsSnapshot([]stream.Op{sObj("shop", "api"), sObj("shop", "web")})
	waitFor(t, "the api service", func() bool {
		_, r := doSearch(t, a, "cluster=c1&q=api")
		g := group(r, "services")
		return g != nil && g.Total == 1
	})
}

func TestOneIndexServesEveryRequestForAPool(t *testing.T) {
	pool := newSPool()
	a := NewSearchAPI(&sFakeBackend{pool: pool})
	defer a.Close()
	for i := 0; i < 5; i++ {
		doSearch(t, a, "cluster=c1&q=api")
	}
	waitFor(t, "services", func() bool { return pool.sub("v1/services") != nil })
	time.Sleep(30 * time.Millisecond)
	if n := pool.count("v1/services"); n != 1 {
		t.Fatalf("services was subscribed %d times; one index should follow it once", n)
	}
}

func TestANewPoolAfterAReconnectGetsAFreshIndexAndTheOldOneIsClosed(t *testing.T) {
	old, fresh := newSPool(), newSPool()
	be := &sFakeBackend{pool: old}
	a := NewSearchAPI(be)
	defer a.Close()
	doSearch(t, a, "cluster=c1&q=api")
	waitFor(t, "old subscription", func() bool { return old.sub("v1/services") != nil })

	old.mu.Lock()
	old.closed = true
	old.mu.Unlock()
	be.swapPool(fresh)
	doSearch(t, a, "cluster=c1&q=api")
	waitFor(t, "new subscription", func() bool { return fresh.sub("v1/services") != nil })
	select {
	case <-old.sub("v1/services").ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("the index on the closed pool was not released")
	}
}

func TestAnIndexNobodyAsksForIsReleased(t *testing.T) {
	pool := newSPool()
	a := NewSearchAPI(&sFakeBackend{pool: pool})
	a.idle = 20 * time.Millisecond
	defer a.Close()
	doSearch(t, a, "cluster=c1&q=api")
	waitFor(t, "services", func() bool { return pool.sub("v1/services") != nil })
	time.Sleep(40 * time.Millisecond)
	a.reapOnce(time.Now())
	select {
	case <-pool.sub("v1/services").ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("an idle index should stop following its kinds")
	}
	// A later search starts again.
	doSearch(t, a, "cluster=c1&q=api")
	waitFor(t, "a second subscription", func() bool { return pool.count("v1/services") == 2 })
}

func TestCustomResourcesAreDiscoveredInTheBackgroundAndSearchable(t *testing.T) {
	pool := newSPool()
	be := &sFakeBackend{pool: pool, crds: []searchindex.CRD{
		{Name: "rollouts.argoproj.io", Group: "argoproj.io", Version: "v1alpha1", Plural: "rollouts", Singular: "rollout", Kind: "Rollout", Namespaced: true},
		{Name: "widgets.acme.example", Group: "acme.example", Version: "v1", Plural: "widgets", Singular: "widget", Kind: "Widget", Namespaced: true},
	}}
	a := NewSearchAPI(be)
	defer a.Close()
	doSearch(t, a, "cluster=c1&q=rollouts+api")
	waitFor(t, "the rollouts subscription (a known group is followed by default)", func() bool {
		doSearch(t, a, "cluster=c1&q=api")
		return pool.sub("argoproj.io/v1alpha1/rollouts") != nil
	})
	if pool.sub("acme.example/v1/widgets") != nil {
		t.Error("an unfamiliar group's kind must not be followed until it is named")
	}
	doSearch(t, a, "cluster=c1&q=widget+x")
	waitFor(t, "widgets once named", func() bool { return pool.sub("acme.example/v1/widgets") != nil })

	pool.sub("argoproj.io/v1alpha1/rollouts").snap <- stream.OpsSnapshot([]stream.Op{sObj("shop", "api")})
	waitFor(t, "the rollout", func() bool {
		_, r := doSearch(t, a, "cluster=c1&q=rollout+api")
		g := group(r, "ext--argoproj.io--v1alpha1--rollouts")
		return g != nil && g.Total == 1
	})
	_, r := doSearch(t, a, "cluster=c1&q=crd+rollouts")
	if g := group(r, "crds"); g == nil || g.Hits[0].Name != "rollouts.argoproj.io" {
		t.Errorf("the CRD itself should be searchable: %+v", r.Groups)
	}
}

func TestACatalogueThatCannotBeListedIsReportedAndBuiltInsStillWork(t *testing.T) {
	pool := newSPool()
	a := NewSearchAPI(&sFakeBackend{pool: pool, crdErr: errors.New("forbidden: cannot list customresourcedefinitions")})
	defer a.Close()
	doSearch(t, a, "cluster=c1&q=api")
	waitFor(t, "the reason", func() bool {
		_, r := doSearch(t, a, "cluster=c1&q=api")
		for _, d := range r.Denied {
			if d.Label == "Custom resources" {
				return true
			}
		}
		return false
	})
	waitFor(t, "services still followed", func() bool { return pool.sub("v1/services") != nil })
}

func TestAClusterThatCannotBeConnectedIsABadGateway(t *testing.T) {
	a := NewSearchAPI(&sFakeBackend{pool: newSPool(), connectErr: errors.New("no such cluster")})
	defer a.Close()
	if code, _ := doSearch(t, a, "cluster=nope&q=api"); code != http.StatusBadGateway {
		t.Errorf("status %d", code)
	}
}

// The endpoint lists the name of every object in a cluster, so it sits behind
// the same token as the rest of the API.
func TestSearchRouteNeedsTheEngineToken(t *testing.T) {
	a := NewSearchAPI(&sFakeBackend{pool: newSPool()})
	defer a.Close()
	h := Router(Deps{Search: a}, "secret")

	ask := func(token string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/search?cluster=c1&q=api", nil)
		if token != "" {
			req.Header.Set("X-Kubebay-Token", token)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := ask(""); code != http.StatusUnauthorized {
		t.Errorf("without a token: %d, want 401", code)
	}
	if code := ask("wrong"); code != http.StatusUnauthorized {
		t.Errorf("with a wrong token: %d, want 401", code)
	}
	if code := ask("secret"); code != http.StatusOK {
		t.Errorf("with the token: %d, want 200", code)
	}
}
