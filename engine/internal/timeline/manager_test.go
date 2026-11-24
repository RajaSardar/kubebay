package timeline

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func memOpener(created *[]*MemStore) func(string) (Store, error) {
	return func(path string) (Store, error) {
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			return nil, err
		}
		m := NewMemStore()
		*created = append(*created, m)
		return m, nil
	}
}

func newMgr(t *testing.T, days int) (*Manager, string, *[]*MemStore) {
	t.Helper()
	dir := t.TempDir()
	var made []*MemStore
	m := NewManager(ManagerOptions{Dir: dir, RetentionDays: days, Open: memOpener(&made)})
	t.Cleanup(m.Close)
	return m, dir, &made
}

func TestManagerOffRecordsNothingAndOpensNothing(t *testing.T) {
	m, dir, made := newMgr(t, 0)
	if err := m.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	m.Observe("c1", upd(deploy("1", 1, "k", "2026-03-01T10:00:00Z"), deploy("2", 2, "k", "2026-03-01T10:01:00Z")))
	m.WatchStart("c1", "Deployment", "")
	if len(*made) != 0 || m.Store() != nil || m.Status().Enabled {
		t.Errorf("off but opened: %d stores", len(*made))
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Errorf("files written while off: %v", ents)
	}
}

func TestManagerSetRetentionOpensRecordsAndOffDeletesTheFile(t *testing.T) {
	m, dir, _ := newMgr(t, 0)
	_ = m.Start(t.Context())
	if err := m.SetRetention(7); err != nil {
		t.Fatal(err)
	}
	if !m.Status().Enabled || m.Status().RetentionDays != 7 {
		t.Fatalf("%+v", m.Status())
	}
	m.Observe("c1", upd(deploy("1", 1, "k", "2026-03-01T10:00:00Z"), deploy("2", 2, "k", "2026-03-01T10:01:00Z")))
	if err := m.Flush(); err != nil {
		t.Fatal(err)
	}
	p, _ := m.Store().Query(Query{Cluster: "c1"})
	if len(p.Changes) != 1 {
		t.Fatalf("rows: %d", len(p.Changes))
	}
	// leftovers of the database and a set-aside corrupt copy go too
	_ = os.WriteFile(filepath.Join(dir, "timeline.db-wal"), []byte("w"), 0o600)
	_ = os.WriteFile(filepath.Join(dir, "timeline.db.corrupt-1"), []byte("c"), 0o600)
	if err := m.SetRetention(0); err != nil {
		t.Fatal(err)
	}
	if m.Store() != nil || m.Status().Enabled {
		t.Error("still enabled")
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Errorf("turning retention off left files: %v", ents)
	}
}

func TestManagerRejectsRetentionOutsideZeroToThirty(t *testing.T) {
	m, _, _ := newMgr(t, 7)
	for _, d := range []int{-1, 31, 365} {
		if err := m.SetRetention(d); err == nil {
			t.Errorf("%d accepted", d)
		}
	}
	if m.Status().RetentionDays != 7 {
		t.Error("retention changed by a rejected value")
	}
}

func TestManagerPrunesPastRetention(t *testing.T) {
	m, _, made := newMgr(t, 1)
	_ = m.Start(t.Context())
	st := (*made)[0]
	old := time.Now().Add(-48 * time.Hour)
	fresh := time.Now()
	_ = st.Append([]Change{{Cluster: "c1", TS: old, Kind: "Pod", Name: "old"}, {Cluster: "c1", TS: fresh, Kind: "Pod", Name: "new"}})
	if err := m.PruneNow(); err != nil {
		t.Fatal(err)
	}
	p, _ := st.Query(Query{Cluster: "c1"})
	if len(p.Changes) != 1 || p.Changes[0].Name != "new" {
		t.Errorf("%+v", p.Changes)
	}
}

func TestManagerOpenFailureIsReportedNotFatal(t *testing.T) {
	m := NewManager(ManagerOptions{Dir: t.TempDir(), RetentionDays: 7, Open: func(string) (Store, error) { return nil, errors.New("disk on fire") }})
	defer m.Close()
	if err := m.Start(t.Context()); err == nil {
		t.Error("open failure not returned")
	}
	st := m.Status()
	if st.Enabled || st.Error == "" {
		t.Errorf("%+v", st)
	}
	m.Observe("c1", upd(deploy("1", 1, "k", "2026-03-01T10:00:00Z"), deploy("2", 2, "k", "2026-03-01T10:01:00Z"))) // must not panic
}
