package timeline

import (
	"sort"
	"sync"
	"time"
)

// MemStore is an in-memory Store: the fake the recorder and HTTP tests run
// against, and the contract the SQLite store is held to.
type MemStore struct {
	mu     sync.Mutex
	next   int64
	rows   []Change
	spans  map[spanKey]Span
	closed bool
}

type spanKey struct {
	cluster, kind, ns string
	start             int64
}

func NewMemStore() *MemStore { return &MemStore{spans: map[spanKey]Span{}} }

func (m *MemStore) Append(rows []Change) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range rows {
		m.next++
		r.ID = m.next
		m.rows = append(m.rows, r)
	}
	return nil
}

func (m *MemStore) PutSpans(spans []Span) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range spans {
		m.spans[spanKey{s.Cluster, s.Kind, s.Namespace, s.Start.UnixMilli()}] = s
	}
	return nil
}

func (m *MemStore) Query(q Query) (Page, error) {
	if q.Cluster == "" {
		return Page{}, errNoCluster
	}
	cur, hasCur, err := parseCursor(q.Cursor)
	if err != nil {
		return Page{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Change
	for _, r := range m.rows {
		if r.Cluster != q.Cluster || (q.Namespace != "" && r.Namespace != q.Namespace) || (q.Kind != "" && r.Kind != q.Kind) || (q.Manager != "" && r.FieldManager != q.Manager) {
			continue
		}
		if !q.From.IsZero() && r.TS.UnixMilli() < q.From.UnixMilli() || !q.To.IsZero() && r.TS.UnixMilli() > q.To.UnixMilli() {
			continue
		}
		if hasCur && !(r.TS.UnixMilli() < cur.ms || r.TS.UnixMilli() == cur.ms && r.ID < cur.id) {
			continue
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].TS.Equal(out[j].TS) {
			return out[i].TS.After(out[j].TS)
		}
		return out[i].ID > out[j].ID
	})
	n := limitOf(q.Limit)
	page := Page{}
	if len(out) > n {
		out = out[:n]
		last := out[n-1]
		page.NextCursor = cursor{last.TS.UnixMilli(), last.ID}.String()
	}
	page.Changes = out
	return page, nil
}

func (m *MemStore) Spans(cluster, kind string, from, to time.Time) ([]Span, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Span
	for _, s := range m.spans {
		if s.Cluster == cluster && s.Kind == kind && !s.End.Before(from) && !s.Start.After(to) {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Start.Before(out[j].Start) })
	return out, nil
}

func (m *MemStore) Facets(cluster string) (Facets, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k, n, g := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, r := range m.rows {
		if r.Cluster != cluster {
			continue
		}
		k[r.Kind], n[r.Namespace], g[r.FieldManager] = true, true, true
	}
	return Facets{Kinds: keys(k), Namespaces: keys(n), Managers: keys(g)}, nil
}

// keys is the non-empty keys, sorted.
func keys(m map[string]bool) []string {
	out := []string{}
	for k := range m {
		if k != "" {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func (m *MemStore) Prune(before time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int64
	kept := m.rows[:0]
	for _, r := range m.rows {
		if r.TS.Before(before) {
			n++
			continue
		}
		kept = append(kept, r)
	}
	m.rows = kept
	for k, s := range m.spans {
		if s.End.Before(before) {
			delete(m.spans, k)
			n++
		}
	}
	return n, nil
}

func (m *MemStore) Stats() (Stats, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return Stats{Rows: int64(len(m.rows))}, nil
}

func (m *MemStore) Clear(cluster string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.rows[:0]
	for _, r := range m.rows {
		if cluster != "" && r.Cluster != cluster {
			kept = append(kept, r)
		}
	}
	m.rows = kept
	for k := range m.spans {
		if cluster == "" || k.cluster == cluster {
			delete(m.spans, k)
		}
	}
	return nil
}

func (m *MemStore) Close() error { m.closed = true; return nil }
