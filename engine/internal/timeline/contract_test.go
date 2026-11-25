package timeline

import (
	"testing"
	"time"
)

var t0 = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func row(cluster string, min int, kind, ns, name, mgr string) Change {
	return Change{Cluster: cluster, TS: t0.Add(time.Duration(min) * time.Minute), Kind: kind, Resource: kind, Namespace: ns, Name: name,
		UID: kind + "/" + ns + "/" + name, Op: OpUpdate, FieldManager: mgr,
		Fields: []FieldChange{{Path: "spec.replicas", Kind: "changed"}}}
}

// storeContract is what every Store must do; MemStore and the SQLite store
// both run it, so the fake the recorder and HTTP tests use cannot drift.
func storeContract(t *testing.T, open func(t *testing.T) Store) {
	t.Run("newest first, filtered by every facet", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		if err := s.Append([]Change{
			row("c1", 1, "Deployment", "web", "a", "kubectl"),
			row("c1", 2, "Pod", "web", "p", "kubelet"),
			row("c1", 3, "Deployment", "db", "b", "argocd"),
			row("c2", 4, "Deployment", "web", "z", "kubectl"),
		}); err != nil {
			t.Fatal(err)
		}
		all, err := s.Query(Query{Cluster: "c1"})
		if err != nil || len(all.Changes) != 3 {
			t.Fatalf("c1: %v %d", err, len(all.Changes))
		}
		if all.Changes[0].Name != "b" || all.Changes[2].Name != "a" {
			t.Errorf("not newest first: %+v", all.Changes)
		}
		if all.Changes[0].Fields[0].Path != "spec.replicas" {
			t.Errorf("fields lost: %+v", all.Changes[0])
		}
		for name, c := range map[string]struct {
			q    Query
			want int
		}{
			"namespace": {Query{Cluster: "c1", Namespace: "web"}, 2},
			"kind":      {Query{Cluster: "c1", Kind: "Deployment"}, 2},
			"manager":   {Query{Cluster: "c1", Manager: "kubelet"}, 1},
			"from":      {Query{Cluster: "c1", From: t0.Add(2 * time.Minute)}, 2},
			"to":        {Query{Cluster: "c1", To: t0.Add(2 * time.Minute)}, 2},
			"combined":  {Query{Cluster: "c1", Namespace: "web", Kind: "Deployment", Manager: "kubectl"}, 1},
		} {
			p, err := s.Query(c.q)
			if err != nil || len(p.Changes) != c.want {
				t.Errorf("%s: %v got %d want %d", name, err, len(p.Changes), c.want)
			}
		}
	})

	t.Run("a cluster never reads another's rows", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		_ = s.Append([]Change{row("c2", 1, "Pod", "x", "only-c2", "m")})
		p, _ := s.Query(Query{Cluster: "c1"})
		if len(p.Changes) != 0 {
			t.Errorf("leak: %+v", p.Changes)
		}
		if _, err := s.Query(Query{}); err == nil {
			t.Error("a query without a cluster must be refused")
		}
	})

	t.Run("pages cover every row once", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		var rows []Change
		for i := 0; i < 25; i++ {
			rows = append(rows, row("c1", i/3, "Pod", "ns", "p"+string(rune('a'+i)), "m")) // equal timestamps
		}
		_ = s.Append(rows)
		seen := map[string]bool{}
		cursor := ""
		for pages := 0; pages < 20; pages++ {
			p, err := s.Query(Query{Cluster: "c1", Limit: 7, Cursor: cursor})
			if err != nil {
				t.Fatal(err)
			}
			for _, c := range p.Changes {
				if seen[c.Name] {
					t.Fatalf("%s twice", c.Name)
				}
				seen[c.Name] = true
			}
			if p.NextCursor == "" {
				break
			}
			cursor = p.NextCursor
		}
		if len(seen) != 25 {
			t.Errorf("saw %d of 25", len(seen))
		}
		if _, err := s.Query(Query{Cluster: "c1", Cursor: "garbage"}); err == nil {
			t.Error("a bad cursor must be refused")
		}
	})

	t.Run("limit is capped", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		var rows []Change
		for i := 0; i < MaxQueryLimit+20; i++ {
			rows = append(rows, row("c1", 0, "Pod", "ns", "p", "m"))
		}
		_ = s.Append(rows)
		p, _ := s.Query(Query{Cluster: "c1", Limit: 100000})
		if len(p.Changes) != MaxQueryLimit {
			t.Errorf("got %d", len(p.Changes))
		}
	})

	t.Run("facets list distinct values", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		_ = s.Append([]Change{row("c1", 1, "Deployment", "web", "a", "kubectl"), row("c1", 2, "Pod", "web", "p", "kubelet"), row("c1", 3, "Pod", "db", "q", "kubelet"), row("c2", 3, "Node", "", "n", "other")})
		f, err := s.Facets("c1")
		if err != nil {
			t.Fatal(err)
		}
		if len(f.Kinds) != 2 || len(f.Namespaces) != 2 || len(f.Managers) != 2 {
			t.Errorf("facets: %+v", f)
		}
	})

	t.Run("prune drops old rows and spans", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		_ = s.Append([]Change{row("c1", 0, "Pod", "n", "old", "m"), row("c1", 120, "Pod", "n", "new", "m")})
		_ = s.PutSpans([]Span{{Cluster: "c1", Kind: "Pod", Start: t0, End: t0.Add(time.Minute)}, {Cluster: "c1", Kind: "Pod", Start: t0.Add(3 * time.Hour), End: t0.Add(4 * time.Hour)}})
		n, err := s.Prune(t0.Add(time.Hour))
		if err != nil || n < 1 {
			t.Fatalf("pruned %d: %v", n, err)
		}
		p, _ := s.Query(Query{Cluster: "c1"})
		if len(p.Changes) != 1 || p.Changes[0].Name != "new" {
			t.Errorf("left: %+v", p.Changes)
		}
		sp, _ := s.Spans("c1", "Pod", t0.Add(-time.Hour), t0.Add(24*time.Hour))
		if len(sp) != 1 {
			t.Errorf("spans left: %+v", sp)
		}
	})

	t.Run("clear scopes to a cluster", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		_ = s.Append([]Change{row("c1", 1, "Pod", "n", "a", "m"), row("c2", 1, "Pod", "n", "b", "m")})
		_ = s.PutSpans([]Span{{Cluster: "c1", Kind: "Pod", Start: t0, End: t0.Add(time.Minute)}, {Cluster: "c2", Kind: "Pod", Start: t0, End: t0.Add(time.Minute)}})
		if err := s.Clear("c1"); err != nil {
			t.Fatal(err)
		}
		p1, _ := s.Query(Query{Cluster: "c1"})
		p2, _ := s.Query(Query{Cluster: "c2"})
		if len(p1.Changes) != 0 || len(p2.Changes) != 1 {
			t.Errorf("c1 %d c2 %d", len(p1.Changes), len(p2.Changes))
		}
		if sp, _ := s.Spans("c1", "Pod", t0.Add(-time.Hour), t0.Add(time.Hour)); len(sp) != 0 {
			t.Error("c1 spans survive")
		}
		if err := s.Clear(""); err != nil {
			t.Fatal(err)
		}
		if p, _ := s.Query(Query{Cluster: "c2"}); len(p.Changes) != 0 {
			t.Error("clear all left rows")
		}
	})

	t.Run("a span is extended in place and found by overlap", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		sp := Span{Cluster: "c1", Kind: "Pod", Namespace: "", Start: t0, End: t0.Add(time.Minute)}
		_ = s.PutSpans([]Span{sp})
		sp.End = t0.Add(10 * time.Minute)
		sp.Reason = "watch stopped"
		_ = s.PutSpans([]Span{sp})
		got, err := s.Spans("c1", "Pod", t0.Add(5*time.Minute), t0.Add(20*time.Minute))
		if err != nil || len(got) != 1 || !got[0].End.Equal(t0.Add(10*time.Minute)) || got[0].Reason != "watch stopped" {
			t.Errorf("%v %+v", err, got)
		}
		if got, _ := s.Spans("c1", "Pod", t0.Add(11*time.Minute), t0.Add(20*time.Minute)); len(got) != 0 {
			t.Errorf("non-overlapping span returned: %+v", got)
		}
		if got, _ := s.Spans("c1", "Node", t0, t0.Add(time.Hour)); len(got) != 0 {
			t.Errorf("other kind: %+v", got)
		}
	})

	t.Run("stats count rows", func(t *testing.T) {
		s := open(t)
		defer s.Close()
		_ = s.Append([]Change{row("c1", 1, "Pod", "n", "a", "m"), row("c1", 2, "Pod", "n", "b", "m")})
		st, err := s.Stats()
		if err != nil || st.Rows != 2 {
			t.Errorf("%v %+v", err, st)
		}
	})
}

func TestMemStoreContract(t *testing.T) {
	storeContract(t, func(*testing.T) Store { return NewMemStore() })
}
