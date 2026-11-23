package fleet

// Cross-cluster search of clusters that are not connected (backlog 12,
// docs/MANY_CLUSTERS.md). A connected cluster is searched from its in-memory
// index; this answers for the rest without connecting them: bounded, paged
// metadata LISTs, at most Concurrency clusters at a time, a hard cap per
// cluster and a TTL cache of names per (identity, cluster, kind). It starts no
// informer, opens no watch and never calls Connect, so the warm cap holds.

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/metadata"
	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/searchindex"
)

const (
	// MaxHits caps the objects one answer returns, across every cluster.
	MaxHits = 200
	// searchPageSize and searchMaxPages bound one kind's LIST (5000 objects).
	searchPageSize = 500
	searchMaxPages = 10
	// maxCachedNames bounds the names held across every cluster; the oldest
	// kind's names go first.
	maxCachedNames = 500_000
)

// ColdKinds are the kinds searched when the query names none: the workloads,
// Services, Ingresses, ConfigMaps and namespaces. Naming any other built-in
// kind ("pvc data") lists that kind alone.
var ColdKinds = []string{"pods", "deployments", "statefulsets", "daemonsets", "jobs", "cronjobs", "services", "ingresses", "configmaps", "namespaces"}

// unsupportedNote is the answer to a query for custom resources or CRDs.
const unsupportedNote = "Custom resources and CRDs aren't searched in clusters that aren't connected."

// ColdHit is one object found in a cluster that is not connected.
type ColdHit struct {
	Cluster string `json:"cluster"`
	// Slug is the UI's route key for the kind ("deployments").
	Slug string `json:"slug"`
	// Kind is its label ("Deployments").
	Kind  string `json:"kind"`
	NS    string `json:"ns"`
	Name  string `json:"name"`
	Score int    `json:"score"`
}

// ClusterSearch is what one cluster's search came to.
type ClusterSearch struct {
	ID string `json:"id"`
	// Pending: a LIST is running; the hits so far may be partial or stale.
	Pending bool `json:"pending,omitempty"`
	// Error: the cluster could not be searched (unreachable, credentials, timed out).
	Error string `json:"error,omitempty"`
	// Denied names kinds the identity may not list, with the API server's reason.
	Denied []searchindex.Denial `json:"denied"`
	// Truncated names kinds that had more objects than one search lists.
	Truncated []string `json:"truncated"`
	// Hits is how many objects matched here, before the answer's cap.
	Hits      int        `json:"hits"`
	CheckedAt *time.Time `json:"checkedAt,omitempty"`
}

// SearchResult is the answer for every cluster asked about.
type SearchResult struct {
	Hits []ColdHit `json:"hits"`
	// Total matched before the cap; Capped when Hits holds fewer.
	Total  int  `json:"total"`
	Capped bool `json:"capped"`
	// Kinds are the labels of the kinds searched.
	Kinds []string `json:"kinds"`
	// Unsupported says why nothing was searched (a query for custom resources).
	Unsupported string          `json:"unsupported,omitempty"`
	Clusters    []ClusterSearch `json:"clusters"`
}

type objName struct{ ns, name string }

type kindNames struct {
	names     []objName
	at        time.Time
	denied    string
	truncated bool
}

type searchSlot struct {
	kinds    map[string]*kindNames
	inflight bool
	err      string
	errAt    time.Time
	touched  time.Time
}

// Searcher answers cross-cluster searches of clusters that are not connected.
// Search never blocks on the network: missing or stale names come back
// pending and the client asks again.
type Searcher struct {
	ttl      time.Duration
	timeout  time.Duration
	now      func() time.Time
	sem      chan struct{}
	pageSize int
	maxPages int

	mu    sync.Mutex
	slots map[string]*searchSlot
	names int
	wg    sync.WaitGroup
}

// NewSearcher takes the same bounds as the summary tier: a 60 s TTL, 10
// clusters at a time and a 12 s hard cap per cluster by default.
func NewSearcher(o Options) *Searcher {
	if o.TTL <= 0 {
		o.TTL = DefaultTTL
	}
	if o.Concurrency <= 0 {
		o.Concurrency = DefaultConcurrency
	}
	if o.Timeout <= 0 {
		o.Timeout = DefaultTimeout
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return &Searcher{ttl: o.TTL, timeout: o.Timeout, now: o.Now, sem: make(chan struct{}, o.Concurrency),
		pageSize: searchPageSize, maxPages: searchMaxPages, slots: map[string]*searchSlot{}}
}

// kindsFor reads the query: the kind it names, or the default kinds, and the
// words to match. ok is false for a kind this search can't list.
func kindsFor(q string) (kinds []searchindex.Kind, terms []string, ok bool) {
	aliases, _ := searchindex.Reserved()
	slug, terms := searchindex.ParseQuery(q, aliases)
	if slug != "" {
		k, found := searchindex.KindBySlug(slug)
		if !found {
			return nil, terms, false
		}
		return []searchindex.Kind{k}, terms, true
	}
	for _, s := range ColdKinds {
		if k, found := searchindex.KindBySlug(s); found {
			kinds = append(kinds, k)
		}
	}
	return kinds, terms, true
}

// Search answers q for each id (deduplicated, at most MaxPerRequest) from the
// cached names, and starts a LIST for a cluster whose names are missing or
// stale. scope keeps identities apart (the OIDC user, "" on desktop). A nil
// cfg only reads the cache.
func (s *Searcher) Search(scope string, ids []string, q string, cfg ConfigFunc) SearchResult {
	res := SearchResult{Hits: []ColdHit{}, Kinds: []string{}, Clusters: []ClusterSearch{}}
	if strings.TrimSpace(q) == "" {
		return res
	}
	kinds, terms, ok := kindsFor(q)
	if !ok {
		res.Unsupported = unsupportedNote
		return res
	}
	if len(kinds) == 0 {
		return res
	}
	for _, k := range kinds {
		res.Kinds = append(res.Kinds, k.Label)
	}
	listing := len(terms) == 0

	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		if len(res.Clusters) == MaxPerRequest {
			break
		}
		seen[id] = true
		key := scope + "\x00" + id
		sl := s.slots[key]
		if sl == nil {
			sl = &searchSlot{kinds: map[string]*kindNames{}}
			s.slots[key] = sl
		}
		sl.touched = now
		failed := sl.err != "" && now.Sub(sl.errAt) < s.ttl
		if cfg != nil && !sl.inflight && !failed {
			var stale []searchindex.Kind
			for _, k := range kinds {
				if kn := sl.kinds[k.Slug]; kn == nil || now.Sub(kn.at) >= s.ttl {
					stale = append(stale, k)
				}
			}
			if len(stale) > 0 {
				s.startLocked(key, id, sl, stale, cfg)
			}
		}
		cs := ClusterSearch{ID: id, Pending: sl.inflight, Denied: []searchindex.Denial{}, Truncated: []string{}}
		if sl.err != "" && (sl.inflight || now.Sub(sl.errAt) < s.ttl || cfg == nil) {
			cs.Error = sl.err
			at := sl.errAt
			cs.CheckedAt = &at
		}
		for _, k := range kinds {
			kn := sl.kinds[k.Slug]
			if kn == nil {
				continue
			}
			if cs.CheckedAt == nil || kn.at.Before(*cs.CheckedAt) {
				at := kn.at
				cs.CheckedAt = &at
			}
			if kn.denied != "" {
				cs.Denied = append(cs.Denied, searchindex.Denial{Label: k.Label, Reason: kn.denied})
			}
			if kn.truncated {
				cs.Truncated = append(cs.Truncated, k.Label)
			}
			for _, o := range kn.names {
				if score := searchindex.ScoreName(o.ns, o.name, terms); score > 0 {
					res.Hits = append(res.Hits, ColdHit{Cluster: id, Slug: k.Slug, Kind: k.Label, NS: o.ns, Name: o.name, Score: score})
					cs.Hits++
				}
			}
		}
		res.Clusters = append(res.Clusters, cs)
	}
	sortColdHits(res.Hits, listing)
	res.Total = len(res.Hits)
	if len(res.Hits) > MaxHits {
		res.Hits, res.Capped = res.Hits[:MaxHits], true
	}
	return res
}

func sortColdHits(hits []ColdHit, listing bool) {
	sort.SliceStable(hits, func(i, j int) bool {
		a, b := hits[i], hits[j]
		if !listing {
			if a.Score != b.Score {
				return a.Score > b.Score
			}
			if len(a.Name) != len(b.Name) {
				return len(a.Name) < len(b.Name)
			}
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		if a.NS != b.NS {
			return a.NS < b.NS
		}
		if a.Cluster != b.Cluster {
			return a.Cluster < b.Cluster
		}
		return a.Slug < b.Slug
	})
}

// pruneLocked drops clusters nobody has searched for ten TTLs.
func (s *Searcher) pruneLocked(now time.Time) {
	for k, sl := range s.slots {
		if !sl.inflight && now.Sub(sl.touched) > 10*s.ttl {
			for _, kn := range sl.kinds {
				s.names -= len(kn.names)
			}
			delete(s.slots, k)
		}
	}
}

// evictLocked drops the oldest kinds' names until the total fits the budget.
func (s *Searcher) evictLocked() {
	for s.names > maxCachedNames {
		var oldSlot *searchSlot
		oldKind := ""
		var oldAt time.Time
		for _, sl := range s.slots {
			for slug, kn := range sl.kinds {
				if oldSlot == nil || kn.at.Before(oldAt) {
					oldSlot, oldKind, oldAt = sl, slug, kn.at
				}
			}
		}
		if oldSlot == nil {
			return
		}
		s.names -= len(oldSlot.kinds[oldKind].names)
		delete(oldSlot.kinds, oldKind)
	}
}

func (s *Searcher) startLocked(key, id string, sl *searchSlot, kinds []searchindex.Kind, cfgFn ConfigFunc) {
	cfg, err := cfgFn(id)
	if err != nil {
		sl.err, sl.errAt = "cluster config: "+err.Error(), s.now()
		return
	}
	sl.inflight = true
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.sem <- struct{}{}
		released := false
		release := func() {
			if !released {
				released = true
				<-s.sem
			}
		}
		defer release()
		type answer struct {
			kinds map[string]*kindNames
			err   string
		}
		done := make(chan answer, 1)
		ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
		defer cancel()
		go func() {
			k, e := s.list(ctx, cfg, kinds)
			done <- answer{k, e}
		}()
		select {
		case a := <-done:
			s.store(key, a.kinds, a.err, true)
		case <-time.After(s.timeout + time.Second):
			// A hung exec credential plugin can ignore the context. Free the
			// slot for other clusters but keep this one in flight until its
			// goroutine returns, so it never stacks a second search.
			release()
			s.store(key, nil, "search timed out (exec credential plugin may be slow or missing)", false)
			<-done
			s.mu.Lock()
			if cur := s.slots[key]; cur != nil {
				cur.inflight = false
			}
			s.mu.Unlock()
		}
	}()
}

func (s *Searcher) store(key string, kinds map[string]*kindNames, errText string, finished bool) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	sl := s.slots[key]
	if sl == nil {
		sl = &searchSlot{kinds: map[string]*kindNames{}, touched: now}
		s.slots[key] = sl
	}
	for slug, kn := range kinds {
		kn.at = now
		if old := sl.kinds[slug]; old != nil {
			s.names -= len(old.names)
		}
		sl.kinds[slug] = kn
		s.names += len(kn.names)
	}
	sl.err, sl.errAt = errText, now
	if finished {
		sl.inflight = false
	}
	s.evictLocked()
}

// Wait blocks until every search started so far has finished (tests).
func (s *Searcher) Wait() { s.wg.Wait() }

func parseGVR(path string) schema.GroupVersionResource {
	parts := strings.Split(path, "/")
	if len(parts) == 2 {
		return schema.GroupVersionResource{Version: parts[0], Resource: parts[1]}
	}
	return schema.GroupVersionResource{Group: parts[0], Version: parts[1], Resource: parts[2]}
}

// list reads the names of each kind, a page at a time. A kind the identity
// may not list is a note on that kind; a kind the cluster doesn't serve is
// empty; any other failure stops the cluster's search and is its error. The
// kinds listed before it are kept.
func (s *Searcher) list(ctx context.Context, base *rest.Config, kinds []searchindex.Kind) (map[string]*kindNames, string) {
	cfg := rest.CopyConfig(base)
	cfg.Timeout = s.timeout
	cfg.QPS, cfg.Burst = 20, 40
	md, err := metadata.NewForConfig(cfg)
	if err != nil {
		return nil, err.Error()
	}
	out := map[string]*kindNames{}
	for _, k := range kinds {
		kn := &kindNames{}
		cont := ""
		for page := 0; ; page++ {
			if page == s.maxPages {
				kn.truncated = true
				break
			}
			list, err := md.Resource(parseGVR(k.GVR)).List(ctx, metav1.ListOptions{Limit: int64(s.pageSize), Continue: cont})
			if err != nil {
				switch {
				case ctx.Err() != nil:
					return out, "search timed out"
				case apierrors.IsForbidden(err):
					kn.names, kn.denied = nil, err.Error()
				case apierrors.IsNotFound(err):
					kn.names = nil // not served by this cluster
				default:
					return out, fmt.Sprintf("%s: %v", k.Label, err)
				}
				break
			}
			for i := range list.Items {
				kn.names = append(kn.names, objName{ns: list.Items[i].Namespace, name: list.Items[i].Name})
			}
			if cont = list.Continue; cont == "" {
				break
			}
		}
		out[k.Slug] = kn
	}
	return out, ""
}
