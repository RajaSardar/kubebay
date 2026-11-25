package timeline

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"modernc.org/sqlite" // pure Go: the engine builds with CGO_ENABLED=0
)

// DefaultMaxBytes is the hard size cap on the database file.
const DefaultMaxBytes int64 = 100 << 20

// ErrNewerSchema is returned for a database written by a newer Kubebay. It is
// left alone: moving it aside would destroy the newer version's data.
var ErrNewerSchema = errors.New("timeline: the database was written by a newer Kubebay")

// migrations[i] takes the schema from version i to i+1.
var migrations = []string{`
CREATE TABLE changes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster       TEXT    NOT NULL,
  ts            INTEGER NOT NULL,
  kind          TEXT    NOT NULL,
  namespace     TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  op            TEXT    NOT NULL,
  field_manager TEXT    NOT NULL DEFAULT '',
  detail        TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX changes_cluster_ts ON changes (cluster, ts, id);
CREATE INDEX changes_cluster_kind ON changes (cluster, kind, namespace, ts);
CREATE INDEX changes_cluster_manager ON changes (cluster, field_manager, ts);
CREATE TABLE coverage (
  cluster   TEXT    NOT NULL,
  kind      TEXT    NOT NULL,
  namespace TEXT    NOT NULL,
  start_ts  INTEGER NOT NULL,
  end_ts    INTEGER NOT NULL,
  reason    TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (cluster, kind, namespace, start_ts)
);
CREATE INDEX coverage_end ON coverage (end_ts);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE facets (
  cluster TEXT NOT NULL,
  col     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (cluster, col, value)
) WITHOUT ROWID;
`}

type SQLiteOptions struct {
	// MaxBytes is the hard cap on live data; the oldest rows go first.
	MaxBytes int64
	Now      func() time.Time
	// BusyTimeout is how long to wait on a lock held elsewhere (default 5s).
	BusyTimeout time.Duration
}

// SQLiteStore is the Store on one SQLite file in WAL mode.
type SQLiteStore struct {
	db        *sql.DB
	path      string
	max       int64
	now       func() time.Time
	recovered string
	evicted   atomic.Int64
	wmu       sync.Mutex // one writer at a time; readers go on in WAL mode
}

// detail is the JSON half of a row: what is not filtered on.
type detail struct {
	Group        string        `json:"g,omitempty"`
	Version      string        `json:"v,omitempty"`
	Resource     string        `json:"r,omitempty"`
	UID          string        `json:"u,omitempty"`
	ObjTime      int64         `json:"ot,omitempty"`
	Fields       []FieldChange `json:"f,omitempty"`
	More         int           `json:"mf,omitempty"`
	MetadataOnly bool          `json:"mo,omitempty"`
	AfterGap     bool          `json:"ag,omitempty"`
	Merged       int           `json:"mg,omitempty"`
	Reason       string        `json:"er,omitempty"`
	Type         string        `json:"et,omitempty"`
	Message      string        `json:"em,omitempty"`
	InvKind      string        `json:"ik,omitempty"`
	InvName      string        `json:"in,omitempty"`
}

// OpenSQLite opens (creating if needed) the database at path. A file that is
// not a usable database is renamed to <path>.corrupt-<time> and replaced;
// Recovered says where it went.
func OpenSQLite(path string, o SQLiteOptions) (*SQLiteStore, error) {
	if o.MaxBytes <= 0 {
		o.MaxBytes = DefaultMaxBytes
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	s, err := openOnce(path, o)
	if err == nil || errors.Is(err, ErrNewerSchema) || !isCorruption(err) {
		// Only a file that is not a database is set aside. A lock held by
		// another process, a full disk or a refused permission leaves it be.
		return s, err
	}
	moved := fmt.Sprintf("%s.corrupt-%d", path, o.Now().Unix())
	if rerr := os.Rename(path, moved); rerr != nil {
		return nil, fmt.Errorf("timeline: database unusable (%v) and could not be set aside: %w", err, rerr)
	}
	_ = os.Remove(path + "-wal")
	_ = os.Remove(path + "-shm")
	s, err2 := openOnce(path, o)
	if err2 != nil {
		return nil, err2
	}
	s.recovered = moved
	return s, nil
}

// errIntegrity marks a failed integrity check.
var errIntegrity = errors.New("timeline: integrity check failed")

// isCorruption is true for the errors SQLite gives for a file that is not a
// usable database (SQLITE_CORRUPT 11, SQLITE_NOTADB 26) and for a failed
// integrity check; anything else (busy, locked, read-only, I/O) is not.
func isCorruption(err error) bool {
	if errors.Is(err, errIntegrity) {
		return true
	}
	var se *sqlite.Error
	if errors.As(err, &se) {
		switch se.Code() & 0xff {
		case 11, 26:
			return true
		}
	}
	return false
}

func openOnce(path string, o SQLiteOptions) (*SQLiteStore, error) {
	// Created private before SQLite does, so the -wal and -shm files follow.
	if f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600); err != nil {
		return nil, err
	} else {
		_ = f.Close()
	}
	_ = os.Chmod(path, 0o600)
	v := url.Values{}
	if o.BusyTimeout <= 0 {
		o.BusyTimeout = 5 * time.Second
	}
	v.Add("_pragma", fmt.Sprintf("busy_timeout(%d)", o.BusyTimeout.Milliseconds()))
	v.Add("_pragma", "journal_mode(WAL)")
	v.Add("_pragma", "synchronous(NORMAL)")
	v.Add("_pragma", "auto_vacuum(INCREMENTAL)")
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?"+v.Encode())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	s := &SQLiteStore{db: db, path: path, max: o.MaxBytes, now: o.Now}
	if err := s.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *SQLiteStore) init() error {
	var ver int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&ver); err != nil {
		return err
	}
	if ver > len(migrations) {
		return ErrNewerSchema
	}
	if ver == 0 {
		// A file that is not a database fails here, on first read.
		var n int
		if err := s.db.QueryRow("SELECT count(*) FROM sqlite_master").Scan(&n); err != nil {
			return err
		}
	}
	var check string
	if err := s.db.QueryRow("PRAGMA quick_check(1)").Scan(&check); err != nil {
		return err
	}
	if check != "ok" {
		return fmt.Errorf("%w: %s", errIntegrity, check)
	}
	for ; ver < len(migrations); ver++ {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[ver]); err != nil {
			_ = tx.Rollback()
			return err
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", ver+1)); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *SQLiteStore) Path() string      { return s.path }
func (s *SQLiteStore) Recovered() string { return s.recovered }

// pragma reads a pragma's value; tests use it to check WAL and the version.
func (s *SQLiteStore) pragma(name string) string {
	var v string
	_ = s.db.QueryRow("PRAGMA " + name).Scan(&v)
	return v
}

func (s *SQLiteStore) Append(rows []Change) error {
	if len(rows) == 0 {
		return nil
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare("INSERT INTO changes (cluster, ts, kind, namespace, name, op, field_manager, detail) VALUES (?,?,?,?,?,?,?,?)")
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()
	// The filter lists are kept beside the rows: a DISTINCT over 100k rows
	// took most of a second.
	fstmt, err := tx.Prepare("INSERT OR IGNORE INTO facets (cluster, col, value) VALUES (?,?,?)")
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer fstmt.Close()
	seen := map[[3]string]bool{}
	for _, r := range rows {
		for col, v := range map[string]string{"kind": r.Kind, "namespace": r.Namespace, "field_manager": r.FieldManager} {
			k := [3]string{r.Cluster, col, v}
			if v == "" || seen[k] {
				continue
			}
			seen[k] = true
			if _, err := fstmt.Exec(r.Cluster, col, v); err != nil {
				_ = tx.Rollback()
				return err
			}
		}
		d := detail{Group: r.Group, Version: r.Version, Resource: r.Resource, UID: r.UID, Fields: r.Fields, More: r.MoreFields,
			MetadataOnly: r.MetadataOnly, AfterGap: r.AfterGap, Merged: r.Merged, Reason: r.Reason, Type: r.Type,
			Message: r.Message, InvKind: r.InvolvedKind, InvName: r.InvolvedName}
		if r.ObjTime != nil {
			d.ObjTime = r.ObjTime.UnixMilli()
		}
		b, err := json.Marshal(d)
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		if _, err := stmt.Exec(r.Cluster, r.TS.UnixMilli(), r.Kind, r.Namespace, r.Name, r.Op, r.FieldManager, string(b)); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return s.enforceCapLocked()
}

// liveBytes is the data in use: pages not on the freelist.
func (s *SQLiteStore) liveBytes() int64 {
	var pages, free, size int64
	_ = s.db.QueryRow("PRAGMA page_count").Scan(&pages)
	_ = s.db.QueryRow("PRAGMA freelist_count").Scan(&free)
	_ = s.db.QueryRow("PRAGMA page_size").Scan(&size)
	return (pages - free) * size
}

// enforceCapLocked evicts the oldest rows until the data is back under 80%
// of the cap, so one batch does not trigger a delete on every append.
func (s *SQLiteStore) enforceCapLocked() error {
	if s.liveBytes() <= s.max {
		return nil
	}
	for i := 0; i < 50 && s.liveBytes() > s.max*8/10; i++ {
		var rows int64
		_ = s.db.QueryRow("SELECT count(*) FROM changes").Scan(&rows)
		if rows == 0 {
			break
		}
		n := max(rows/5, 100)
		var upTo sql.NullInt64
		_ = s.db.QueryRow("SELECT max(ts) FROM (SELECT ts FROM changes ORDER BY ts ASC, id ASC LIMIT ?)", n).Scan(&upTo)
		if upTo.Valid {
			_, _ = s.db.Exec(`INSERT INTO meta (key, value) VALUES ('evicted_before', ?1)
				ON CONFLICT (key) DO UPDATE SET value = ?1 WHERE CAST(value AS INTEGER) < CAST(?1 AS INTEGER)`, fmt.Sprint(upTo.Int64))
		}
		res, err := s.db.Exec("DELETE FROM changes WHERE id IN (SELECT id FROM changes ORDER BY ts ASC, id ASC LIMIT ?)", n)
		if err != nil {
			return err
		}
		if k, _ := res.RowsAffected(); k > 0 {
			s.evicted.Add(k)
		}
		_, _ = s.db.Exec("PRAGMA incremental_vacuum")
	}
	s.rebuildFacetsLocked()
	_, _ = s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return nil
}

func (s *SQLiteStore) PutSpans(spans []Span) error {
	if len(spans) == 0 {
		return nil
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	for _, sp := range spans {
		if _, err := tx.Exec(`INSERT INTO coverage (cluster, kind, namespace, start_ts, end_ts, reason) VALUES (?,?,?,?,?,?)
			ON CONFLICT (cluster, kind, namespace, start_ts) DO UPDATE SET end_ts = excluded.end_ts, reason = excluded.reason`,
			sp.Cluster, sp.Kind, sp.Namespace, sp.Start.UnixMilli(), sp.End.UnixMilli(), sp.Reason); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLiteStore) Query(q Query) (Page, error) {
	if q.Cluster == "" {
		return Page{}, errNoCluster
	}
	cur, hasCur, err := parseCursor(q.Cursor)
	if err != nil {
		return Page{}, err
	}
	where, args := "cluster = ?", []any{q.Cluster}
	if q.Namespace != "" {
		where += " AND namespace = ?"
		args = append(args, q.Namespace)
	}
	if q.Kind != "" {
		where += " AND kind = ?"
		args = append(args, q.Kind)
	}
	if q.Manager != "" {
		where += " AND field_manager = ?"
		args = append(args, q.Manager)
	}
	if !q.From.IsZero() {
		where += " AND ts >= ?"
		args = append(args, q.From.UnixMilli())
	}
	if !q.To.IsZero() {
		where += " AND ts <= ?"
		args = append(args, q.To.UnixMilli())
	}
	if hasCur {
		where += " AND (ts < ? OR (ts = ? AND id < ?))"
		args = append(args, cur.ms, cur.ms, cur.id)
	}
	n := limitOf(q.Limit)
	rows, err := s.db.Query("SELECT id, cluster, ts, kind, namespace, name, op, field_manager, detail FROM changes WHERE "+where+" ORDER BY ts DESC, id DESC LIMIT ?", append(args, n+1)...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	var page Page
	for rows.Next() {
		var c Change
		var ts int64
		var raw string
		if err := rows.Scan(&c.ID, &c.Cluster, &ts, &c.Kind, &c.Namespace, &c.Name, &c.Op, &c.FieldManager, &raw); err != nil {
			return Page{}, err
		}
		c.TS = time.UnixMilli(ts).UTC()
		var d detail
		_ = json.Unmarshal([]byte(raw), &d)
		c.Group, c.Version, c.Resource, c.UID = d.Group, d.Version, d.Resource, d.UID
		c.Fields, c.MoreFields, c.MetadataOnly, c.AfterGap, c.Merged = d.Fields, d.More, d.MetadataOnly, d.AfterGap, d.Merged
		c.Reason, c.Type, c.Message, c.InvolvedKind, c.InvolvedName = d.Reason, d.Type, d.Message, d.InvKind, d.InvName
		if d.ObjTime != 0 {
			t := time.UnixMilli(d.ObjTime).UTC()
			c.ObjTime = &t
		}
		page.Changes = append(page.Changes, c)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	if len(page.Changes) > n {
		page.Changes = page.Changes[:n]
		last := page.Changes[n-1]
		page.NextCursor = cursor{last.TS.UnixMilli(), last.ID}.String()
	}
	return page, nil
}

func (s *SQLiteStore) Spans(cluster, kind string, from, to time.Time) ([]Span, error) {
	rows, err := s.db.Query(`SELECT namespace, start_ts, end_ts, reason FROM coverage
		WHERE cluster = ? AND kind = ? AND end_ts >= ? AND start_ts <= ? ORDER BY start_ts`, cluster, kind, from.UnixMilli(), to.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Span
	for rows.Next() {
		sp := Span{Cluster: cluster, Kind: kind}
		var a, b int64
		if err := rows.Scan(&sp.Namespace, &a, &b, &sp.Reason); err != nil {
			return nil, err
		}
		sp.Start, sp.End = time.UnixMilli(a).UTC(), time.UnixMilli(b).UTC()
		out = append(out, sp)
	}
	return out, rows.Err()
}

func (s *SQLiteStore) Facets(cluster string) (Facets, error) {
	f := Facets{Kinds: []string{}, Namespaces: []string{}, Managers: []string{}}
	for col, dst := range map[string]*[]string{"kind": &f.Kinds, "namespace": &f.Namespaces, "field_manager": &f.Managers} {
		rows, err := s.db.Query("SELECT value FROM facets WHERE cluster = ? AND col = ? ORDER BY value LIMIT 500", cluster, col)
		if err != nil {
			return Facets{}, err
		}
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				rows.Close()
				return Facets{}, err
			}
			*dst = append(*dst, v)
		}
		rows.Close()
	}
	return f, nil
}

// rebuildFacetsLocked recomputes the filter lists from the rows left, after
// rows were deleted. It scans, so it runs only when something was removed.
func (s *SQLiteStore) rebuildFacetsLocked() {
	_, _ = s.db.Exec("DELETE FROM facets")
	for _, col := range []string{"kind", "namespace", "field_manager"} {
		_, _ = s.db.Exec("INSERT INTO facets (cluster, col, value) SELECT DISTINCT cluster, '" + col + "', " + col + " FROM changes WHERE " + col + " != ''")
	}
}

func (s *SQLiteStore) Prune(before time.Time) (int64, error) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	var total int64
	for _, q := range []string{"DELETE FROM changes WHERE ts < ?", "DELETE FROM coverage WHERE end_ts < ?"} {
		res, err := s.db.Exec(q, before.UnixMilli())
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += n
	}
	if total > 0 {
		s.rebuildFacetsLocked()
		_, _ = s.db.Exec("PRAGMA incremental_vacuum")
		_, _ = s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	}
	return total, nil
}

func (s *SQLiteStore) Stats() (Stats, error) {
	var rows int64
	if err := s.db.QueryRow("SELECT count(*) FROM changes").Scan(&rows); err != nil {
		return Stats{}, err
	}
	st := Stats{Rows: rows, DBBytes: s.liveBytes(), CapBytes: s.max, Evicted: s.evicted.Load()}
	var ms int64
	if err := s.db.QueryRow("SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'evicted_before'").Scan(&ms); err == nil && ms > 0 {
		st.EvictedBefore = time.UnixMilli(ms).UTC()
	}
	return st, nil
}

func (s *SQLiteStore) Clear(cluster string) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	for _, t := range []string{"changes", "coverage", "facets"} {
		var err error
		if cluster == "" {
			_, err = s.db.Exec("DELETE FROM " + t)
		} else {
			_, err = s.db.Exec("DELETE FROM "+t+" WHERE cluster = ?", cluster)
		}
		if err != nil {
			return err
		}
	}
	_, _ = s.db.Exec("PRAGMA incremental_vacuum")
	_, _ = s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return nil
}

func (s *SQLiteStore) Close() error { return s.db.Close() }
