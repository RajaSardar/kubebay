// Package history keeps a local, hourly rollup of cluster and namespace
// usage so trend and anomaly features have more than the sampler's
// in-memory window to work with (innovation backlog #36).
//
// It records only while the app is open, only for clusters the user has
// connected to (the caller filters), and never fills a gap: an hour with no
// samples reads back as null. Every series carries its Coverage so a
// consumer can say what the numbers do and don't cover.
package history

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultRetention is fixed by the backlog #36 decision: 35 days, enough
	// for an hour-of-week baseline with missed days, and a later cut can always
	// be made where a later increase can't recover pruned data.
	DefaultRetention     = 35 * 24 * time.Hour
	defaultMaxNamespaces = 50
	defaultMaxTotalBytes = 256 << 20
	defaultWellSampledN  = 30
	// defaultMaxHealthLines bounds a bad hour on a big cluster to ~22 KB.
	defaultMaxHealthLines = 200
	defaultHeartbeat      = 60 * time.Second

	// OtherNamespace holds every namespace beyond the cap, so totals still add up.
	OtherNamespace = "(other)"

	lineVersion = 1
	openFile    = "open.json"
	metaFile    = "meta.json"
	lockFile    = "writer.lock"
)

// ErrReadOnly is returned by writes when another engine holds the writer lock.
var ErrReadOnly = errors.New("history: another Kubebay engine is writing this directory")

// Obs is one tick's usage for one namespace; Ns "" is the cluster total.
type Obs struct {
	Ns           string
	CPUMillis    int64
	MemBytes     int64
	HasUsage     bool // false when metrics-server gave nothing: usage stays null
	ReqCPUMillis int64
	ReqMemBytes  int64
	// Broken lists the workloads that were broken this tick, as
	// "namespace/Kind/name". Only the cluster total (Ns "") carries it.
	Broken []string
	// Capacity, on the cluster total only; Nodes 0 means unknown this tick.
	AllocCPUMillis int64
	AllocMemBytes  int64
	Nodes          int
}

// Meta identifies the cluster behind a fingerprint directory.
type Meta struct {
	ClusterID string `json:"clusterId"`
	Context   string `json:"context"`
	Server    string `json:"server"`
}

type Options struct {
	Retention     time.Duration
	MaxNamespaces int
	MaxTotalBytes int64
	WellSampledN  int
	// MaxHealthLines caps the broken workloads kept per hour, worst first.
	MaxHealthLines int
	// Heartbeat is the expected write cadence; a lock older than 3 heartbeats is stale.
	Heartbeat time.Duration
	Now       func() time.Time
	// Location is the time zone coverage labels are expressed in (default time.Local).
	Location *time.Location
}

// Point is one hour of one namespace. Usage fields are nil when no tick in
// the hour had usage; every field is nil (and Samples 0) for an unobserved hour.
type Point struct {
	Hour         time.Time `json:"t"`
	Samples      int       `json:"n"`
	WellSampled  bool      `json:"wellSampled"`
	CPUMean      *float64  `json:"cpuMean"`
	CPUMax       *float64  `json:"cpuMax"`
	MemMean      *float64  `json:"memMean"`
	MemMax       *float64  `json:"memMax"`
	ReqCPUMillis *int64    `json:"reqCpuMillis"`
	ReqMemBytes  *int64    `json:"reqMemBytes"`
}

type Series struct {
	Ns       string   `json:"ns"`
	Source   string   `json:"source"`
	Points   []Point  `json:"points"`
	Coverage Coverage `json:"coverage"`
}

// acc accumulates one namespace's ticks within the open hour.
type acc struct {
	N      int     `json:"n"`
	UN     int     `json:"un"`
	CPUSum float64 `json:"cs"`
	MemSum float64 `json:"ms"`
	CPUMax int64   `json:"cx"`
	MemMax int64   `json:"mx"`
	ReqCPU int64   `json:"rc"`
	ReqMem int64   `json:"rm"`
	// Last known capacity within the hour; a tick without it keeps the old value.
	AllocCPU int64 `json:"ac,omitempty"`
	AllocMem int64 `json:"am,omitempty"`
	Nodes    int   `json:"nd,omitempty"`
}

type openHour struct {
	Hour time.Time       `json:"hour"`
	ByNs map[string]*acc `json:"byNs"`
	// Health counts, per broken workload, the ticks it was broken this hour.
	Health map[string]int `json:"health,omitempty"`
}

// line is one closed namespace-hour in a day file.
type line struct {
	V  int       `json:"v"`
	H  time.Time `json:"h"`
	Ns string    `json:"ns"`
	N  int       `json:"n"`
	UN int       `json:"un"`
	CM *float64  `json:"cm,omitempty"`
	CX *float64  `json:"cx,omitempty"`
	MM *float64  `json:"mm,omitempty"`
	MX *float64  `json:"mx,omitempty"`
	RC int64     `json:"rc"`
	RM int64     `json:"rm"`
	AC int64     `json:"ac,omitempty"`
	AM int64     `json:"am,omitempty"`
	ND int       `json:"nd,omitempty"`
}

type cluster struct {
	open *openHour
	meta *Meta
}

type Store struct {
	dir      string
	o        Options
	mu       sync.Mutex
	readOnly bool
	closed   bool
	token    string
	clusters map[string]*cluster
}

// Open prepares dir (0700) and takes the writer lock. There is deliberately
// no fallback directory: if dir can't be used, the caller runs without history.
func Open(dir string, o Options) (*Store, error) {
	if o.Retention <= 0 {
		o.Retention = DefaultRetention
	}
	if o.MaxNamespaces <= 0 {
		o.MaxNamespaces = defaultMaxNamespaces
	}
	if o.MaxTotalBytes <= 0 {
		o.MaxTotalBytes = defaultMaxTotalBytes
	}
	if o.WellSampledN <= 0 {
		o.WellSampledN = defaultWellSampledN
	}
	if o.MaxHealthLines <= 0 {
		o.MaxHealthLines = defaultMaxHealthLines
	}
	if o.Heartbeat <= 0 {
		o.Heartbeat = defaultHeartbeat
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Location == nil {
		o.Location = time.Local
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("history dir: %w", err)
	}
	s := &Store{dir: dir, o: o, clusters: map[string]*cluster{}, token: fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())}
	if err := s.acquireLock(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) ReadOnly() bool { return s.readOnly }

// Dir is where history lives, for display next to the Clear control.
func (s *Store) Dir() string { return s.dir }

func (s *Store) RetentionDays() int { return int(s.o.Retention / (24 * time.Hour)) }

type lockBody struct {
	PID       int       `json:"pid"`
	Token     string    `json:"token"`
	Heartbeat time.Time `json:"heartbeat"`
}

// acquireLock takes writer.lock unless another engine refreshed it within
// three heartbeats. A PID+heartbeat lock rather than O_EXCL, because the
// desktop wrapper can SIGKILL the engine and an O_EXCL lock would then stay
// held forever.
func (s *Store) acquireLock() error {
	b, err := os.ReadFile(filepath.Join(s.dir, lockFile))
	if err == nil {
		var l lockBody
		if json.Unmarshal(b, &l) == nil && s.o.Now().Sub(l.Heartbeat) < 3*s.o.Heartbeat {
			s.readOnly = true
			return nil
		}
	}
	return s.heartbeat()
}

func (s *Store) heartbeat() error {
	b, _ := json.Marshal(lockBody{PID: os.Getpid(), Token: s.token, Heartbeat: s.o.Now()})
	return writeAtomic(filepath.Join(s.dir, lockFile), b)
}

func writeAtomic(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// load returns the in-memory state for fp, restoring an open hour a previous
// (possibly killed) engine checkpointed.
func (s *Store) load(fp string) *cluster {
	if c, ok := s.clusters[fp]; ok {
		return c
	}
	c := &cluster{}
	if b, err := os.ReadFile(filepath.Join(s.dir, fp, openFile)); err == nil {
		var oh openHour
		if json.Unmarshal(b, &oh) == nil && oh.ByNs != nil {
			c.open = &oh
		}
	}
	s.clusters[fp] = c
	return c
}

// Record adds one tick's observations for the cluster fingerprinted fp.
func (s *Store) Record(fp string, meta Meta, at time.Time, obs []Obs) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly || s.closed {
		return ErrReadOnly
	}
	cdir := filepath.Join(s.dir, fp)
	if err := os.MkdirAll(cdir, 0o700); err != nil {
		return err
	}
	c := s.load(fp)
	if c.meta == nil || *c.meta != meta {
		if err := s.writeMeta(cdir, meta); err != nil {
			return err
		}
		m := meta
		c.meta = &m
	}

	hour := at.UTC().Truncate(time.Hour)
	if c.open != nil && hour.Before(c.open.Hour) {
		return nil // clock went backwards; never rewrite a closed hour
	}
	if c.open != nil && hour.After(c.open.Hour) {
		if err := s.flush(cdir, c.open); err != nil {
			return err
		}
		c.open = nil
	}
	if c.open == nil {
		c.open = &openHour{Hour: hour, ByNs: map[string]*acc{}}
	}
	for _, o := range capNamespaces(obs, s.o.MaxNamespaces) {
		a := c.open.ByNs[o.Ns]
		if a == nil {
			a = &acc{}
			c.open.ByNs[o.Ns] = a
		}
		a.N++
		a.ReqCPU, a.ReqMem = o.ReqCPUMillis, o.ReqMemBytes
		if o.Nodes > 0 {
			a.AllocCPU, a.AllocMem, a.Nodes = o.AllocCPUMillis, o.AllocMemBytes, o.Nodes
		}
		if o.HasUsage {
			a.UN++
			a.CPUSum += float64(o.CPUMillis)
			a.MemSum += float64(o.MemBytes)
			a.CPUMax = max(a.CPUMax, o.CPUMillis)
			a.MemMax = max(a.MemMax, o.MemBytes)
		}
	}
	for _, o := range obs {
		if o.Ns != "" {
			continue
		}
		for _, w := range o.Broken {
			if c.open.Health == nil {
				c.open.Health = map[string]int{}
			}
			c.open.Health[w]++
		}
	}
	b, _ := json.Marshal(c.open)
	if err := writeAtomic(filepath.Join(cdir, openFile), b); err != nil {
		return err
	}
	return s.heartbeat()
}

func (s *Store) writeMeta(cdir string, m Meta) error {
	b, _ := json.Marshal(struct {
		Meta
		Version       int `json:"version"`
		RetentionDays int `json:"retentionDays"`
	}{m, lineVersion, s.RetentionDays()})
	return writeAtomic(filepath.Join(cdir, metaFile), b)
}

// capNamespaces keeps the cluster total plus the top n namespaces by
// requested CPU, folding the rest into OtherNamespace.
func capNamespaces(obs []Obs, n int) []Obs {
	var total []Obs
	var ns []Obs
	for _, o := range obs {
		if o.Ns == "" {
			total = append(total, o)
		} else {
			ns = append(ns, o)
		}
	}
	if len(ns) <= n {
		return obs
	}
	sort.SliceStable(ns, func(i, j int) bool {
		if ns[i].ReqCPUMillis != ns[j].ReqCPUMillis {
			return ns[i].ReqCPUMillis > ns[j].ReqCPUMillis
		}
		return ns[i].Ns < ns[j].Ns
	})
	other := Obs{Ns: OtherNamespace}
	for _, o := range ns[n:] {
		other.CPUMillis += o.CPUMillis
		other.MemBytes += o.MemBytes
		other.ReqCPUMillis += o.ReqCPUMillis
		other.ReqMemBytes += o.ReqMemBytes
		other.HasUsage = other.HasUsage || o.HasUsage
	}
	return append(append(total, ns[:n]...), other)
}

func dayFile(cdir string, hour time.Time) string {
	return filepath.Join(cdir, hour.UTC().Format("2006-01-02")+".jsonl")
}

func (s *Store) flush(cdir string, oh *openHour) error {
	fh, err := os.OpenFile(dayFile(cdir, oh.Hour), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer fh.Close()
	names := make([]string, 0, len(oh.ByNs))
	for ns := range oh.ByNs {
		names = append(names, ns)
	}
	sort.Strings(names)
	w := bufio.NewWriter(fh)
	for _, ns := range names {
		b, _ := json.Marshal(toLine(oh.Hour, ns, oh.ByNs[ns]))
		_, _ = w.Write(append(b, '\n'))
	}
	if err := w.Flush(); err != nil {
		return err
	}
	return s.flushHealth(cdir, oh)
}

func toLine(h time.Time, ns string, a *acc) line {
	l := line{V: lineVersion, H: h, Ns: ns, N: a.N, UN: a.UN, RC: a.ReqCPU, RM: a.ReqMem, AC: a.AllocCPU, AM: a.AllocMem, ND: a.Nodes}
	if a.UN > 0 {
		cm, mm := a.CPUSum/float64(a.UN), a.MemSum/float64(a.UN)
		cx, mx := float64(a.CPUMax), float64(a.MemMax)
		l.CM, l.CX, l.MM, l.MX = &cm, &cx, &mm, &mx
	}
	return l
}

func (s *Store) toPoint(l line) Point {
	rc, rm := l.RC, l.RM
	return Point{Hour: l.H, Samples: l.N, WellSampled: l.N >= s.o.WellSampledN, CPUMean: l.CM, CPUMax: l.CX, MemMean: l.MM, MemMax: l.MX, ReqCPUMillis: &rc, ReqMemBytes: &rm}
}

// readRange returns every stored line for fp in [from, to), keyed by hour and
// namespace, overlaid with the in-memory open hour. A torn or unparsable line
// (a crash mid-write) is skipped; the lines before it still count.
func (s *Store) readRange(fp string, from, to time.Time) map[time.Time]map[string]line {
	out := map[time.Time]map[string]line{}
	put := func(l line) {
		if l.H.Before(from) || !l.H.Before(to) {
			return
		}
		if out[l.H] == nil {
			out[l.H] = map[string]line{}
		}
		out[l.H][l.Ns] = l
	}
	cdir := filepath.Join(s.dir, fp)
	for d := from.UTC().Truncate(24 * time.Hour); d.Before(to); d = d.Add(24 * time.Hour) {
		fh, err := os.Open(dayFile(cdir, d))
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(fh)
		sc.Buffer(make([]byte, 64*1024), 1<<20)
		for sc.Scan() {
			var l line
			if json.Unmarshal(sc.Bytes(), &l) != nil || l.V != lineVersion {
				continue
			}
			put(l)
		}
		_ = fh.Close()
	}
	if c := s.load(fp); c.open != nil {
		for ns, a := range c.open.ByNs {
			put(toLine(c.open.Hour, ns, a))
		}
	}
	return out
}

// Query returns one point per hour in [from, to) for namespace ns ("" = cluster total).
func (s *Store) Query(fp, ns string, from, to time.Time) (Series, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	from, to = from.UTC().Truncate(time.Hour), to.UTC()
	lines := s.readRange(fp, from, to)
	ser := Series{Ns: ns, Source: "local", Points: []Point{}}
	for h := from; h.Before(to); h = h.Add(time.Hour) {
		if l, ok := lines[h][ns]; ok {
			ser.Points = append(ser.Points, s.toPoint(l))
		} else {
			ser.Points = append(ser.Points, Point{Hour: h})
		}
	}
	ser.Coverage = s.coverage(fp)
	return ser, nil
}

// Status reports the cluster's coverage over the retention window.
func (s *Store) Status(fp string) (Coverage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.coverage(fp), nil
}

// Prune drops day files older than the retention window, then enforces the
// total-size guard by deleting the oldest remaining day across all clusters.
func (s *Store) Prune(now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly {
		return ErrReadOnly
	}
	cutoff := now.Add(-s.o.Retention).UTC().Format("2006-01-02")
	type day struct {
		date, path string
		size       int64
	}
	var days []day
	var totalBytes int64
	dirs, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		files, _ := os.ReadDir(filepath.Join(s.dir, d.Name()))
		for _, f := range files {
			date, ok := strings.CutSuffix(f.Name(), ".jsonl")
			if !ok {
				continue
			}
			p := filepath.Join(s.dir, d.Name(), f.Name())
			if date < cutoff {
				if err := os.Remove(p); err != nil {
					return err
				}
				continue
			}
			if info, err := f.Info(); err == nil {
				days = append(days, day{date, p, info.Size()})
				totalBytes += info.Size()
			}
		}
	}
	sort.Slice(days, func(i, j int) bool {
		if days[i].date != days[j].date {
			return days[i].date < days[j].date
		}
		return days[i].path < days[j].path
	})
	for _, d := range days {
		if totalBytes <= s.o.MaxTotalBytes {
			break
		}
		if err := os.Remove(d.path); err != nil {
			return err
		}
		totalBytes -= d.size
	}
	return nil
}

// EraseCluster deletes every fingerprint directory recorded for clusterID
// (a recreated cluster leaves more than one) and forgets their open hours.
func (s *Store) EraseCluster(clusterID string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly {
		return 0, ErrReadOnly
	}
	dirs, err := os.ReadDir(s.dir)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, d.Name(), metaFile))
		if err != nil {
			continue
		}
		var m Meta
		if json.Unmarshal(b, &m) != nil || m.ClusterID != clusterID {
			continue
		}
		if err := os.RemoveAll(filepath.Join(s.dir, d.Name())); err != nil {
			return n, err
		}
		delete(s.clusters, d.Name())
		n++
	}
	return n, nil
}

// Close releases the writer lock. The open hour stays checkpointed in
// open.json and is closed by whichever engine records the next hour.
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	if s.readOnly {
		return nil
	}
	b, err := os.ReadFile(filepath.Join(s.dir, lockFile))
	if err != nil {
		return nil
	}
	var l lockBody
	if json.Unmarshal(b, &l) == nil && l.Token == s.token {
		return os.Remove(filepath.Join(s.dir, lockFile))
	}
	return nil
}
