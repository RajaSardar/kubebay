package timeline

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Retention bounds, in days. 0 is off.
const (
	DefaultRetentionDays = 7
	MaxRetentionDays     = 30
	dbFile               = "timeline.db"
)

// ManagerOptions configure a Manager. Open is the store constructor (SQLite
// in production, MemStore in tests).
type ManagerOptions struct {
	Dir           string
	RetentionDays int
	Open          func(path string) (Store, error)
	Log           *slog.Logger
	PruneEvery    time.Duration
	Now           func() time.Time
}

// ManagerStatus is what the settings and the page show.
type ManagerStatus struct {
	Enabled       bool   `json:"enabled"`
	RetentionDays int    `json:"retentionDays"`
	Rows          int64  `json:"rows"`
	DBBytes       int64  `json:"dbBytes"`
	CapBytes      int64  `json:"capBytes"`
	Evicted       int64  `json:"evicted"`
	Dropped       int64  `json:"dropped"`
	Recovered     string `json:"recovered,omitempty"`
	Error         string `json:"error,omitempty"`
}

// Manager owns the timeline's lifecycle: it opens the store while retention
// is above zero, runs the recorder and the pruning loop, and deletes the
// files when retention is turned off. Its Observe and Watch methods do
// nothing while it is off.
type Manager struct {
	o ManagerOptions

	mu        sync.RWMutex
	days      int
	store     Store
	rec       *Recorder
	cancel    context.CancelFunc
	done      chan struct{}
	err       string
	recovered string
	ctx       context.Context
}

func NewManager(o ManagerOptions) *Manager {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.PruneEvery <= 0 {
		o.PruneEvery = time.Hour
	}
	if o.RetentionDays < 0 || o.RetentionDays > MaxRetentionDays {
		o.RetentionDays = DefaultRetentionDays
	}
	return &Manager{o: o, days: o.RetentionDays}
}

// Start opens the store when retention is on. A failure leaves the timeline
// off with the reason in Status; the engine carries on.
func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ctx = ctx
	if m.days == 0 {
		return nil
	}
	return m.openLocked()
}

func (m *Manager) path() string { return filepath.Join(m.o.Dir, dbFile) }

func (m *Manager) openLocked() error {
	if m.store != nil {
		return nil
	}
	if m.o.Open == nil {
		m.err = "no store configured"
		return errors.New(m.err)
	}
	if err := os.MkdirAll(m.o.Dir, 0o700); err != nil {
		m.err = err.Error()
		return err
	}
	st, err := m.o.Open(m.path())
	if err != nil {
		m.err = err.Error()
		if m.o.Log != nil {
			m.o.Log.Warn("timeline disabled", "err", err)
		}
		return err
	}
	m.err = ""
	if r, ok := st.(interface{ Recovered() string }); ok {
		m.recovered = r.Recovered()
	}
	m.store = st
	m.rec = NewRecorder(st, Options{Now: m.o.Now})
	parent := m.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	m.cancel, m.done = cancel, make(chan struct{})
	rec, done := m.rec, m.done
	go func() {
		defer close(done)
		go func() {
			t := time.NewTicker(m.o.PruneEvery)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					_ = m.PruneNow()
				}
			}
		}()
		rec.Run(ctx)
	}()
	_ = m.pruneLocked()
	return nil
}

func (m *Manager) pruneLocked() error {
	if m.store == nil || m.days == 0 {
		return nil
	}
	_, err := m.store.Prune(m.o.Now().Add(-time.Duration(m.days) * 24 * time.Hour))
	return err
}

// PruneNow drops what is older than the retention window.
func (m *Manager) PruneNow() error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pruneLocked()
}

func (m *Manager) closeLocked() {
	if m.store == nil {
		return
	}
	m.cancel()
	<-m.done
	_ = m.store.Close()
	m.store, m.rec, m.cancel, m.done = nil, nil, nil, nil
}

// SetRetention applies a retention of 0 (off, and the files are deleted) to
// 30 days.
func (m *Manager) SetRetention(days int) error {
	if days < 0 || days > MaxRetentionDays {
		return fmt.Errorf("retention must be between 0 and %d days", MaxRetentionDays)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.days = days
	if days == 0 {
		m.closeLocked()
		m.recovered, m.err = "", ""
		files, _ := filepath.Glob(m.path() + "*")
		for _, f := range files {
			if err := os.Remove(f); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return nil
	}
	if err := m.openLocked(); err != nil {
		return err
	}
	return m.pruneLocked()
}

// Retention is the current setting in days (0 = off).
func (m *Manager) Retention() int { m.mu.RLock(); defer m.mu.RUnlock(); return m.days }

// Store is the open store, or nil while off or unavailable.
func (m *Manager) Store() Store { m.mu.RLock(); defer m.mu.RUnlock(); return m.store }

// Active reports whether anything is recording, so a caller can skip the work
// of describing an event nobody will keep.
func (m *Manager) Active() bool { m.mu.RLock(); defer m.mu.RUnlock(); return m.rec != nil }

func (m *Manager) Observe(cluster string, ob Observed) {
	m.mu.RLock()
	r := m.rec
	m.mu.RUnlock()
	if r != nil {
		r.Observe(cluster, ob)
	}
}

func (m *Manager) WatchStart(cluster, kind, ns string) {
	m.mu.RLock()
	r := m.rec
	m.mu.RUnlock()
	if r != nil {
		r.WatchStart(cluster, kind, ns)
	}
}

func (m *Manager) WatchEnd(cluster, kind, ns, reason string) {
	m.mu.RLock()
	r := m.rec
	m.mu.RUnlock()
	if r != nil {
		r.WatchEnd(cluster, kind, ns, reason)
	}
}

// Flush writes the recorder's buffer now.
func (m *Manager) Flush() error {
	m.mu.RLock()
	r := m.rec
	m.mu.RUnlock()
	if r == nil {
		return nil
	}
	return r.Flush()
}

// Status summarises the timeline.
func (m *Manager) Status() ManagerStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s := ManagerStatus{Enabled: m.store != nil, RetentionDays: m.days, Recovered: m.recovered, Error: m.err}
	if m.store != nil {
		if st, err := m.store.Stats(); err == nil {
			s.Rows, s.DBBytes, s.CapBytes, s.Evicted = st.Rows, st.DBBytes, st.CapBytes, st.Evicted
		}
		rs := m.rec.Status()
		s.Dropped = rs.Dropped
		if rs.LastError != "" && s.Error == "" {
			s.Error = rs.LastError
		}
	}
	return s
}

// Close stops recording and closes the store, keeping the file.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closeLocked()
}
