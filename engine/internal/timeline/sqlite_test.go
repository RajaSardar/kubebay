package timeline

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openTemp(t *testing.T) *SQLiteStore {
	t.Helper()
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "timeline.db"), SQLiteOptions{})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSQLiteStoreContract(t *testing.T) {
	storeContract(t, func(t *testing.T) Store { return openTemp(t) })
}

func TestSQLiteIsWALWithAVersionedSchemaAndPrivateFile(t *testing.T) {
	s := openTemp(t)
	defer s.Close()
	if got := s.pragma("journal_mode"); got != "wal" {
		t.Errorf("journal_mode = %q", got)
	}
	if got := s.pragma("user_version"); got != "1" {
		t.Errorf("user_version = %q", got)
	}
	fi, err := os.Stat(s.Path())
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v", fi.Mode().Perm())
	}
}

func TestSQLiteKeepsRowsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.db")
	s, _ := OpenSQLite(path, SQLiteOptions{})
	_ = s.Append([]Change{row("c1", 1, "Pod", "n", "a", "m")})
	_ = s.Close()
	s2, err := OpenSQLite(path, SQLiteOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if p, _ := s2.Query(Query{Cluster: "c1"}); len(p.Changes) != 1 {
		t.Errorf("rows after reopen: %d", len(p.Changes))
	}
	if s2.Recovered() != "" {
		t.Errorf("a healthy file was treated as corrupt: %s", s2.Recovered())
	}
}

func TestSQLiteRecoversFromACorruptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "t.db")
	if err := os.WriteFile(path, []byte(strings.Repeat("this is not a database ", 500)), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := OpenSQLite(path, SQLiteOptions{Now: func() time.Time { return t0 }})
	if err != nil {
		t.Fatalf("a corrupt file must be replaced, got %v", err)
	}
	defer s.Close()
	if s.Recovered() == "" || !strings.Contains(s.Recovered(), ".corrupt-") {
		t.Errorf("Recovered = %q", s.Recovered())
	}
	if _, err := os.Stat(s.Recovered()); err != nil {
		t.Errorf("the corrupt file was not kept: %v", err)
	}
	if err := s.Append([]Change{row("c1", 1, "Pod", "n", "a", "m")}); err != nil {
		t.Errorf("new database unusable: %v", err)
	}
}

func TestSQLiteRefusesANewerSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.db")
	s, _ := OpenSQLite(path, SQLiteOptions{})
	if _, err := s.db.Exec("PRAGMA user_version = 99"); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	if _, err := OpenSQLite(path, SQLiteOptions{}); err == nil {
		t.Fatal("a database from a newer Kubebay must not be opened or overwritten")
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("the newer database was moved: %v", err)
	}
}

func TestSQLiteSizeCapEvictsOldestFirst(t *testing.T) {
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "t.db"), SQLiteOptions{MaxBytes: 256 << 10})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for b := 0; b < 40; b++ {
		var rows []Change
		for i := 0; i < 100; i++ {
			c := row("c1", b, "Pod", "ns", fmt.Sprintf("pod-%d-%d", b, i), "kubelet")
			c.Message = strings.Repeat("x", 200)
			rows = append(rows, c)
		}
		if err := s.Append(rows); err != nil {
			t.Fatal(err)
		}
	}
	st, _ := s.Stats()
	if st.DBBytes > 256<<10+64<<10 {
		t.Errorf("db is %d bytes over a 256 KiB cap", st.DBBytes)
	}
	if st.Evicted == 0 {
		t.Error("nothing was evicted")
	}
	if st.EvictedBefore.IsZero() || st.EvictedBefore.After(t0.Add(40*time.Minute)) {
		t.Errorf("the cap must say how far back it removed rows: %v", st.EvictedBefore)
	}
	p, _ := s.Query(Query{Cluster: "c1", Limit: 1})
	if len(p.Changes) != 1 || !strings.HasPrefix(p.Changes[0].Name, "pod-39-") {
		t.Errorf("newest row gone: %+v", p.Changes)
	}
	old, _ := s.Query(Query{Cluster: "c1", To: t0.Add(2 * time.Minute)})
	if len(old.Changes) != 0 {
		t.Errorf("oldest rows survive the cap: %d", len(old.Changes))
	}
}

func TestSQLiteInjectionSafeFilters(t *testing.T) {
	s := openTemp(t)
	defer s.Close()
	_ = s.Append([]Change{row("c1", 1, "Pod", "n", "a", "m")})
	p, err := s.Query(Query{Cluster: "c1", Namespace: "x' OR '1'='1"})
	if err != nil || len(p.Changes) != 0 {
		t.Errorf("%v %d", err, len(p.Changes))
	}
}

// 100k rows: a filtered, paginated query stays well under the bound. Skipped
// with -short; the bound is generous so a loaded CI machine does not flake.
func TestSQLiteQueryLatencyAt100kRows(t *testing.T) {
	if testing.Short() {
		t.Skip("100k-row perf test")
	}
	s := openTemp(t)
	defer s.Close()
	for b := 0; b < 200; b++ {
		rows := make([]Change, 0, 500)
		for i := 0; i < 500; i++ {
			n := b*500 + i
			rows = append(rows, Change{Cluster: "c1", TS: t0.Add(time.Duration(n) * time.Second), Kind: []string{"Pod", "Deployment", "Node", "Service"}[n%4],
				Resource: "x", Namespace: fmt.Sprintf("ns-%d", n%20), Name: fmt.Sprintf("obj-%d", n), Op: OpUpdate, FieldManager: fmt.Sprintf("mgr-%d", n%7),
				Fields: []FieldChange{{Path: "spec.replicas", Kind: "changed"}}})
		}
		if err := s.Append(rows); err != nil {
			t.Fatal(err)
		}
	}
	queries := []Query{
		{Cluster: "c1", Limit: 100},
		{Cluster: "c1", Namespace: "ns-3", Kind: "Pod", Limit: 100},
		{Cluster: "c1", Manager: "mgr-2", Limit: 100},
		{Cluster: "c1", From: t0.Add(10 * time.Hour), To: t0.Add(11 * time.Hour), Limit: 100},
	}
	for _, q := range queries {
		var worst time.Duration
		cur := ""
		for page := 0; page < 5; page++ {
			q.Cursor = cur
			start := time.Now()
			p, err := s.Query(q)
			if d := time.Since(start); d > worst {
				worst = d
			}
			if err != nil {
				t.Fatal(err)
			}
			if cur = p.NextCursor; cur == "" {
				break
			}
		}
		if worst > 200*time.Millisecond {
			t.Errorf("%+v: slowest page %v", q, worst)
		}
	}
	start := time.Now()
	if _, err := s.Facets("c1"); err != nil {
		t.Fatal(err)
	}
	if d := time.Since(start); d > 500*time.Millisecond {
		t.Errorf("facets took %v", d)
	}
}

func TestSQLiteFacetsFollowPruneAndClear(t *testing.T) {
	s := openTemp(t)
	defer s.Close()
	_ = s.Append([]Change{
		{Cluster: "c1", TS: t0, Kind: "Pod", Namespace: "old", Name: "a", Op: OpUpdate, FieldManager: "gone-mgr"},
		{Cluster: "c1", TS: t0.Add(48 * time.Hour), Kind: "Node", Namespace: "new", Name: "b", Op: OpUpdate, FieldManager: "kept-mgr"},
		{Cluster: "c2", TS: t0.Add(48 * time.Hour), Kind: "Job", Namespace: "other", Name: "c", Op: OpUpdate, FieldManager: "kubectl"},
	})
	if f, _ := s.Facets("c1"); len(f.Kinds) != 2 || len(f.Managers) != 2 || len(f.Namespaces) != 2 {
		t.Fatalf("%+v", f)
	}
	if _, err := s.Prune(t0.Add(24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	f, _ := s.Facets("c1")
	if len(f.Kinds) != 1 || f.Kinds[0] != "Node" || f.Managers[0] != "kept-mgr" || f.Namespaces[0] != "new" {
		t.Errorf("pruned values still offered: %+v", f)
	}
	_ = s.Clear("c2")
	if f, _ := s.Facets("c2"); len(f.Kinds) != 0 {
		t.Errorf("cleared cluster still has facets: %+v", f)
	}
	if f, _ := s.Facets("c1"); len(f.Kinds) != 1 {
		t.Errorf("another cluster's facets were cleared: %+v", f)
	}
}

// A database another process holds locked is not corrupt: it must not be
// moved aside (that would take the file out from under its owner).
func TestSQLiteDoesNotSetAsideALockedDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.db")
	s, err := OpenSQLite(path, SQLiteOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Append([]Change{row("c1", 1, "Pod", "n", "a", "m")}); err != nil {
		t.Fatal(err)
	}
	s.Close()
	holder, err := sql.Open("sqlite", "file:"+path+"?_pragma=locking_mode(EXCLUSIVE)&_pragma=journal_mode(DELETE)")
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	holder.SetMaxOpenConns(1)
	if _, err := holder.Exec("BEGIN EXCLUSIVE"); err != nil {
		t.Fatal(err)
	}
	s2, err := OpenSQLite(path, SQLiteOptions{BusyTimeout: 50 * time.Millisecond})
	if err == nil {
		s2.Close()
		t.Fatal("a locked database should not open")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the database was moved aside: %v", err)
	}
	if matches, _ := filepath.Glob(path + ".corrupt-*"); len(matches) != 0 {
		t.Fatalf("a healthy, locked file was renamed as corrupt: %v", matches)
	}
}
