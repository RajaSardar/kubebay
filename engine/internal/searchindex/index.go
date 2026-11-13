// Package searchindex answers "find this by name" across the kinds of a cluster
// that the app does not already follow in memory: Services, Ingresses,
// ConfigMaps, Secrets (names only), custom resources, and so on.
//
// It follows each kind through the shared informer pool in metadata mode, so it
// sees exactly what the pool's identity may list and a forbidden kind is skipped
// and said so. Kinds start on demand and stop with the index.
package searchindex

import (
	"context"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// Sub is the part of a pool subscription the index reads.
type Sub interface {
	Snapshot() <-chan stream.Snapshot
	Deltas() <-chan []stream.Op
	CloseReason() string
}

// Subscriber opens a subscription: informers.Pool.Subscribe, in production.
type Subscriber interface {
	Subscribe(ctx context.Context, gvr string, namespaces []string, selector, mode string) (Sub, error)
}

// Limits keeps a runaway kind (a CRD with a million objects) from taking the engine's memory.
type Limits struct {
	PerKind int
	Total   int
}

var DefaultLimits = Limits{PerKind: 100_000, Total: 400_000}

type entry struct {
	ns, name          string
	nsL, nameL, fullL string
}

func newEntry(ns, name string) *entry {
	nsL, nameL := strings.ToLower(ns), strings.ToLower(name)
	return &entry{ns: ns, name: name, nsL: nsL, nameL: nameL, fullL: nsL + "/" + nameL}
}

type kindState struct {
	kind      Kind
	entries   map[string]*entry
	started   bool
	synced    bool
	truncated bool
	denied    string
}

// Index follows kinds and answers searches. Safe for concurrent use.
type Index struct {
	mu     sync.RWMutex
	sub    Subscriber
	lim    Limits
	ctx    context.Context
	cancel context.CancelFunc
	kinds  map[string]*kindState
	order  []string // slugs, in catalogue order
	// aliases is replaced, never edited, so a search can read it without the lock held.
	aliases map[string]string
	total   atomic.Int64
	// The custom-resource catalogue: still being discovered, or why it could not be.
	catalogLoading bool
	catalogErr     string
}

// New builds an index over kinds. It starts nothing until the first search.
func New(sub Subscriber, kinds []Kind, lim Limits) *Index {
	ctx, cancel := context.WithCancel(context.Background())
	ix := &Index{sub: sub, lim: lim, ctx: ctx, cancel: cancel, kinds: map[string]*kindState{}, aliases: map[string]string{}}
	if ix.lim.PerKind == 0 {
		ix.lim = DefaultLimits
	}
	for _, k := range kinds {
		ix.addKind(k)
	}
	return ix
}

func (ix *Index) addKind(k Kind) {
	if _, dup := ix.kinds[k.Slug]; dup {
		return
	}
	ix.kinds[k.Slug] = &kindState{kind: k, entries: map[string]*entry{}}
	ix.order = append(ix.order, k.Slug)
	for _, a := range k.Aliases {
		if _, taken := ix.aliases[a]; !taken {
			ix.aliases[a] = k.Slug
		}
	}
	if k.Synthetic || k.Local {
		ix.kinds[k.Slug].started, ix.kinds[k.Slug].synced = true, true
	}
}

// AddKinds teaches the index more kinds once they are known, as custom
// resources are after discovery. It is safe to call while searches run.
func (ix *Index) AddKinds(kinds []Kind) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	next := make(map[string]string, len(ix.aliases)+len(kinds)*3)
	for a, s := range ix.aliases {
		next[a] = s
	}
	ix.aliases = next
	for _, k := range kinds {
		ix.addKind(k)
	}
}

// SetCatalog records whether custom resources are still being discovered, or
// why they could not be (a search says so instead of silently leaving them out).
func (ix *Index) SetCatalog(loading bool, errText string) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	ix.catalogLoading, ix.catalogErr = loading, errText
}

// SetEntries replaces the entries of a synthetic kind, one whose objects come
// from the catalogue itself (the CRD definitions) rather than an informer.
func (ix *Index) SetEntries(slug string, names []string) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	st := ix.kinds[slug]
	if st == nil {
		return
	}
	ix.total.Add(int64(len(names) - len(st.entries)))
	st.entries = make(map[string]*entry, len(names))
	for _, n := range names {
		st.entries[n] = newEntry("", n)
	}
}

// Close stops every subscription.
func (ix *Index) Close() { ix.cancel() }

// SearchOptions bounds a search.
type SearchOptions struct {
	PerGroup  int
	MaxGroups int
}

// Hit is one match.
type Hit struct {
	NS    string `json:"ns"`
	Name  string `json:"name"`
	Score int    `json:"score"`
}

// Group is one kind's matches.
type Group struct {
	Slug  string `json:"slug"`
	Label string `json:"label"`
	Total int    `json:"total"`
	Hits  []Hit  `json:"hits"`
	// ClusterScoped is set for a custom resource kind with no namespace.
	ClusterScoped bool `json:"clusterScoped"`
}

// Denial is a kind the identity may not list.
type Denial struct {
	Label  string `json:"label"`
	Reason string `json:"reason"`
}

// Result is the answer to one search, with enough to tell a complete answer
// from a partial one.
type Result struct {
	Groups []Group `json:"groups"`
	// Filter is the kind the query named ("services"), or "".
	Filter string `json:"filter"`
	// Indexed is how many objects are searchable right now.
	Indexed int `json:"indexed"`
	// Pending names kinds still listing: results so far are partial.
	Pending []string `json:"pending"`
	// OnDemand names kinds not searched until you name them in the query.
	OnDemand []string `json:"onDemand"`
	// Truncated names kinds that hit their size limit.
	Truncated []string `json:"truncated"`
	Denied    []Denial `json:"denied"`
}

// Search follows the kinds the query needs, then ranks what has arrived.
func (ix *Index) Search(raw string, opts SearchOptions) Result {
	slug, terms := ParseQuery(raw, ix.aliasSnapshot())
	res := Result{Groups: []Group{}, Pending: []string{}, OnDemand: []string{}, Truncated: []string{}, Denied: []Denial{}, Filter: slug}
	if slug == "" && len(terms) == 0 {
		return res
	}
	listing := len(terms) == 0
	if opts.PerGroup == 0 {
		opts.PerGroup = 5
		if listing {
			opts.PerGroup = 25
		}
	}
	if opts.MaxGroups == 0 {
		opts.MaxGroups = 7
	}

	ix.follow(slug)

	ix.mu.RLock()
	defer ix.mu.RUnlock()
	res.Indexed = int(ix.total.Load())
	if ix.catalogLoading {
		res.Pending = append(res.Pending, "Custom resources")
	}
	if ix.catalogErr != "" {
		res.Denied = append(res.Denied, Denial{Label: "Custom resources", Reason: ix.catalogErr})
	}
	for _, s := range ix.order {
		st := ix.kinds[s]
		if st.denied != "" {
			res.Denied = append(res.Denied, Denial{Label: st.kind.Label, Reason: st.denied})
		}
		if st.truncated {
			res.Truncated = append(res.Truncated, st.kind.Label)
		}
		if !st.started && st.kind.Tier == TierOnDemand {
			res.OnDemand = append(res.OnDemand, st.kind.Label)
		}
		if slug != "" && s != slug {
			continue
		}
		if st.started && !st.synced && st.denied == "" {
			res.Pending = append(res.Pending, st.kind.Label)
		}
		hits := make([]Hit, 0, 8)
		for _, e := range st.entries {
			if score := scoreAll(e, terms); score > 0 {
				hits = append(hits, Hit{NS: e.ns, Name: e.name, Score: score})
			}
		}
		if len(hits) == 0 {
			continue
		}
		sortHits(hits, listing)
		total := len(hits)
		if len(hits) > opts.PerGroup {
			hits = hits[:opts.PerGroup]
		}
		res.Groups = append(res.Groups, Group{Slug: s, Label: st.kind.Label, Total: total, Hits: hits, ClusterScoped: st.kind.ClusterScoped})
	}
	sortGroups(res.Groups)
	if len(res.Groups) > opts.MaxGroups {
		res.Groups = res.Groups[:opts.MaxGroups]
	}
	sort.Strings(res.OnDemand)
	return res
}

func (ix *Index) aliasSnapshot() map[string]string {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.aliases // read-only after New
}

// follow starts the kinds a query needs: the named one, or every default kind.
func (ix *Index) follow(slug string) {
	if ix.sub == nil {
		return
	}
	ix.mu.Lock()
	defer ix.mu.Unlock()
	for _, s := range ix.order {
		st := ix.kinds[s]
		if st.started {
			continue
		}
		if (slug != "" && s == slug) || (slug == "" && st.kind.Tier == TierDefault) {
			st.started = true
			go ix.run(st)
		}
	}
}

func (ix *Index) run(st *kindState) {
	sub, err := ix.sub.Subscribe(ix.ctx, st.kind.GVR, nil, "", "metadata")
	if err != nil {
		ix.finish(st, err.Error())
		return
	}
	for {
		select {
		case <-ix.ctx.Done():
			return
		case snap := <-sub.Snapshot():
			ix.replace(st, snap.All())
		case ops, open := <-sub.Deltas():
			if !open {
				ix.finish(st, sub.CloseReason())
				return
			}
			ix.apply(st, ops)
		}
	}
}

func (ix *Index) finish(st *kindState, reason string) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if ix.ctx.Err() != nil {
		return
	}
	st.denied = reason
	if st.denied == "" {
		st.denied = "ended"
	}
}

func nameOf(op stream.Op) (ns, name string) {
	meta, _ := op.Obj["metadata"].(map[string]any)
	name, _ = meta["name"].(string)
	ns, _ = meta["namespace"].(string)
	return ns, name
}

func (ix *Index) replace(st *kindState, ops []stream.Op) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	ix.total.Add(-int64(len(st.entries)))
	st.entries = make(map[string]*entry, len(ops))
	st.truncated = false
	for _, op := range ops {
		ix.put(st, op)
	}
	st.synced = true
}

func (ix *Index) apply(st *kindState, ops []stream.Op) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if !st.synced {
		return // changes before the snapshot are in it
	}
	for _, op := range ops {
		if op.Op == stream.OpDelete {
			ns, name := nameOf(op)
			if name == "" {
				continue
			}
			key := ns + "/" + name
			if _, ok := st.entries[key]; ok {
				delete(st.entries, key)
				ix.total.Add(-1)
			}
			continue
		}
		ix.put(st, op)
	}
}

// put adds or replaces one object, unless the limits say the kind is full.
func (ix *Index) put(st *kindState, op stream.Op) {
	ns, name := nameOf(op)
	if name == "" {
		return
	}
	key := ns + "/" + name
	if _, exists := st.entries[key]; !exists {
		if len(st.entries) >= ix.lim.PerKind || int(ix.total.Load()) >= ix.lim.Total {
			st.truncated = true
			return
		}
		ix.total.Add(1)
	}
	st.entries[key] = newEntry(ns, name)
}
