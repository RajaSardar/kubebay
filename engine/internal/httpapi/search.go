package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/RajaSardar/kubebay/engine/internal/searchindex"
)

// SearchPool is a cluster's shared informer pool, as search needs it.
type SearchPool interface {
	searchindex.Subscriber
	// Closed is true once the cluster was disconnected or the pool replaced.
	Closed() bool
	// Key identifies the pool, so one index serves every request for it.
	Key() any
}

// SearchBackend is what search reads from the engine.
type SearchBackend interface {
	// Connect makes sure the engine has the cluster open, as opening a stream does.
	Connect(cluster string) error
	// Pool is the pool for the identity on ctx (set by the OIDC middleware).
	Pool(ctx context.Context, cluster string) (SearchPool, error)
	// ListCRDs is the cluster's custom resource definitions, for the identity on ctx.
	ListCRDs(ctx context.Context, cluster string) ([]searchindex.CRD, error)
}

// SearchAPI serves GET /api/search. Each pool (a cluster as one identity sees
// it) gets one index, created by its first search and released when nobody has
// searched it for a while or its cluster is disconnected.
type SearchAPI struct {
	be   SearchBackend
	idle time.Duration

	mu      sync.Mutex
	entries map[any]*searchEntry
	stop    chan struct{}
	once    sync.Once
}

type searchEntry struct {
	ix   *searchindex.Index
	pool SearchPool
	last time.Time
}

const maxSearchQuery = 200

func NewSearchAPI(be SearchBackend) *SearchAPI {
	a := &SearchAPI{be: be, idle: 5 * time.Minute, entries: map[any]*searchEntry{}, stop: make(chan struct{})}
	go a.reaper()
	return a
}

// Close releases every index.
func (a *SearchAPI) Close() {
	a.once.Do(func() { close(a.stop) })
	a.mu.Lock()
	defer a.mu.Unlock()
	for k, e := range a.entries {
		e.ix.Close()
		delete(a.entries, k)
	}
}

func (a *SearchAPI) reaper() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-a.stop:
			return
		case now := <-t.C:
			a.reapOnce(now)
		}
	}
}

// reapOnce releases indexes nobody has searched lately, and those whose pool closed.
func (a *SearchAPI) reapOnce(now time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for k, e := range a.entries {
		if e.pool.Closed() || now.Sub(e.last) > a.idle {
			e.ix.Close()
			delete(a.entries, k)
		}
	}
}

func (a *SearchAPI) entryFor(ctx context.Context, cluster string, pool SearchPool) *searchindex.Index {
	a.mu.Lock()
	defer a.mu.Unlock()
	// A reconnect makes a new pool, so the old pool's index is never asked for
	// again: release any whose pool has closed.
	for k, e := range a.entries {
		if e.pool.Closed() {
			e.ix.Close()
			delete(a.entries, k)
		}
	}
	key := pool.Key()
	if e, ok := a.entries[key]; ok {
		e.last = time.Now()
		return e.ix
	}
	kinds := append(searchindex.LocalKinds(), searchindex.BuiltinKinds()...)
	kinds = append(kinds, searchindex.CRDDefinitionsKind())
	ix := searchindex.New(pool, kinds, searchindex.DefaultLimits)
	ix.SetCatalog(true, "")
	a.entries[key] = &searchEntry{ix: ix, pool: pool, last: time.Now()}
	// Discovery can be slow on a big cluster; the first answer must not wait for it.
	go a.discover(context.WithoutCancel(ctx), cluster, ix)
	return ix
}

func (a *SearchAPI) discover(ctx context.Context, cluster string, ix *searchindex.Index) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	crds, err := a.be.ListCRDs(ctx, cluster)
	if err != nil {
		ix.SetCatalog(false, err.Error())
		return
	}
	aliases, covered := searchindex.Reserved()
	ix.SetEntries("crds", searchindex.CRDNames(crds))
	ix.AddKinds(searchindex.CRDKinds(crds, aliases, covered))
	ix.SetCatalog(false, "")
}

func intParam(r *http.Request, name string, def, lo, hi int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil {
		return def
	}
	return max(lo, min(hi, n))
}

// HandleSearch finds objects by name across the kinds the app does not already
// hold in memory. The answer says what is still loading or could not be read, so
// a short list is never mistaken for the whole cluster.
func (a *SearchAPI) HandleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cluster, text := q.Get("cluster"), strings.TrimSpace(q.Get("q"))
	if cluster == "" || text == "" {
		http.Error(w, "cluster and q required", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(text) > maxSearchQuery {
		http.Error(w, "q too long", http.StatusBadRequest)
		return
	}
	if err := a.be.Connect(cluster); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	pool, err := a.be.Pool(r.Context(), cluster)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	ix := a.entryFor(r.Context(), cluster, pool)
	res := ix.Search(text, searchindex.SearchOptions{
		PerGroup:  intParam(r, "perGroup", 0, 0, 50),
		MaxGroups: intParam(r, "maxGroups", 0, 0, 20),
	})
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, res)
}
