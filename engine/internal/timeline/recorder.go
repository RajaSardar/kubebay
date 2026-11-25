package timeline

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/redact"
)

// Recorder defaults.
const (
	DefaultMaxBuffer   = 10000
	DefaultFlushEvery  = 2 * time.Second
	DefaultFlushRows   = 500
	DefaultMergeWindow = 30 * time.Second
	seenCap            = 8192
	reasonAppClosed    = "app closed"
	reasonPaused       = "the computer was asleep or the app was paused"
	// maxHold is the longest a merged row waits for its object to go quiet,
	// in merge windows: an object that never rests is still written.
	maxHoldWindows = 10
	// pausedAfter is how many flush intervals may pass between two flushes
	// before the time between them counts as not watched.
	pausedAfter = 5
)

// Observed is one object event from a watch, as the informer pool sees it.
// Old and New are the cached (managedFields-trimmed) objects.
type Observed struct {
	Group, Version, Resource, ObjKind string
	Op                                string
	Old, New                          map[string]any
	// MetadataOnly: seen through a metadata-only watch.
	MetadataOnly bool
	// AfterGap: seen after a relist (including DeletedFinalStateUnknown).
	AfterGap bool
}

// Options tune a Recorder. Zero values take the defaults.
type Options struct {
	Now         func() time.Time
	MaxBuffer   int
	FlushEvery  time.Duration
	FlushRows   int
	MergeWindow time.Duration
}

// RecorderStatus is what the page shows about the recorder.
type RecorderStatus struct {
	Dropped   int64  `json:"dropped"`
	Pending   int    `json:"pending"`
	LastError string `json:"lastError,omitempty"`
}

type objKey struct{ cluster, uid string }

type burst struct {
	lastSeen  time.Time
	heldSince time.Time
	held      *Change
}

type watchKey struct{ cluster, kind, ns string }

type openSpan struct {
	span  Span
	count int
}

// Recorder turns watch events into rows: it drops noise and Secrets, merges
// bursts on one object, bounds its buffer, writes in batches, and tracks the
// periods each kind was watched.
type Recorder struct {
	st Store
	o  Options

	mu      sync.Mutex
	pending []Change
	bursts  map[objKey]*burst
	seen    map[string]bool
	seenQ   []string // ring of seen keys, oldest at seenAt once full
	seenAt  int
	lastTS  time.Time
	dropped int64
	lastErr string
	open    map[watchKey]*openSpan
	closed  []Span
	kick    chan struct{}
}

// NewRecorder builds a Recorder over st. Call Run to flush on a timer.
func NewRecorder(st Store, o Options) *Recorder {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.MaxBuffer <= 0 {
		o.MaxBuffer = DefaultMaxBuffer
	}
	if o.FlushEvery <= 0 {
		o.FlushEvery = DefaultFlushEvery
	}
	if o.FlushRows <= 0 {
		o.FlushRows = DefaultFlushRows
	}
	if o.MergeWindow <= 0 {
		o.MergeWindow = DefaultMergeWindow
	}
	return &Recorder{st: st, o: o, bursts: map[objKey]*burst{}, seen: map[string]bool{},
		open: map[watchKey]*openSpan{}, kick: make(chan struct{}, 1)}
}

// Run flushes every FlushEvery, and early when a full batch is waiting,
// until ctx ends; then it closes the recorder.
func (r *Recorder) Run(ctx context.Context) {
	t := time.NewTicker(r.o.FlushEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = r.Close()
			return
		case <-t.C:
			_ = r.Flush()
		case <-r.kick:
			_ = r.Flush()
		}
	}
}

// Status reports drops and the backlog.
func (r *Recorder) Status() RecorderStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	return RecorderStatus{Dropped: r.dropped, Pending: len(r.pending), LastError: r.lastErr}
}

func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }

func seenKey(cluster, uid, rv, op string) string {
	return cluster + "|" + uid + "|" + rv + "|" + op
}

func meta(o map[string]any) map[string]any { m, _ := o["metadata"].(map[string]any); return m }

// Observe records one event. It never writes; Flush does.
func (r *Recorder) Observe(cluster string, ob Observed) {
	subject := ob.New
	if ob.Op == OpDelete || subject == nil {
		subject = ob.Old
	}
	if subject == nil {
		return
	}
	kind := KindFor(ob.Resource, ob.ObjKind)
	if kind == "PartialObjectMetadata" || kind == "" {
		kind = str(subject, "kind")
	}
	if Denied(ob.Group, ob.Resource, kind) || str(subject, "kind") == "Secret" || str(ob.Old, "kind") == "Secret" {
		return
	}
	md := meta(subject)
	uid, rv := str(md, "uid"), str(md, "resourceVersion")
	dedup := uid != "" && rv != ""
	now := r.o.Now()

	r.mu.Lock()
	defer r.mu.Unlock()

	var c Change
	if kind == "Event" && ob.Resource == "events" || kind == "Event" && str(subject, "reason") != "" {
		if ob.MetadataOnly {
			return // a metadata watch carries no reason or message
		}
		if !r.eventChange(&c, ob, subject) {
			return
		}
	} else {
		c = Change{Op: ob.Op, Fields: nil}
		// Another watch of this kind already recorded this write: drop it
		// before the diff rather than after.
		if dedup && r.seen[seenKey(cluster, uid, rv, ob.Op)] {
			return
		}
		switch ob.Op {
		case OpUpdate:
			if rv := str(meta(ob.New), "resourceVersion"); rv != "" && rv == str(meta(ob.Old), "resourceVersion") {
				return
			}
			fields, more := Summarize(ob.Old, ob.New)
			if len(fields) == 0 && more == 0 {
				return
			}
			c.Fields, c.MoreFields = fields, more
			if !ob.AfterGap {
				c.FieldManager, c.ObjTime = ManagerOf(ob.Old, ob.New)
			}
		case OpAdd, OpDelete:
		default:
			return
		}
	}
	c.Cluster, c.Group, c.Version, c.Resource, c.Kind = cluster, ob.Group, ob.Version, ob.Resource, kind
	if c.Op != OpEvent {
		c.Namespace, c.Name, c.UID = str(md, "namespace"), str(md, "name"), str(md, "uid")
	}
	c.MetadataOnly, c.AfterGap = ob.MetadataOnly, ob.AfterGap

	// The same change seen by two watches of one kind is one change.
	if dedup {
		sk := seenKey(cluster, uid, rv, c.Op)
		if r.seen[sk] {
			return
		}
		r.seen[sk] = true
		if len(r.seenQ) < seenCap {
			r.seenQ = append(r.seenQ, sk)
		} else {
			delete(r.seen, r.seenQ[r.seenAt])
			r.seenQ[r.seenAt] = sk
			r.seenAt = (r.seenAt + 1) % seenCap
		}
	}
	c.TS = r.stamp(now)

	if c.Op == OpUpdate && c.UID != "" {
		k := objKey{cluster, c.UID}
		b := r.bursts[k]
		if b != nil && now.Sub(b.lastSeen) < r.o.MergeWindow {
			b.lastSeen = now
			if b.held == nil {
				h := c
				h.Merged = 1
				b.held, b.heldSince = &h, now
			} else {
				b.held.Fields, b.held.MoreFields = unionFields(b.held.Fields, c.Fields, b.held.MoreFields+c.MoreFields)
				if c.FieldManager != "" {
					b.held.FieldManager, b.held.ObjTime = c.FieldManager, c.ObjTime
				}
				b.held.TS = c.TS
				b.held.Merged++
			}
			return
		}
		if b != nil && b.held != nil {
			r.enqueue(*b.held)
		}
		r.bursts[k] = &burst{lastSeen: now}
	}
	r.enqueue(c)
}

func (r *Recorder) stamp(now time.Time) time.Time {
	if now.Before(r.lastTS) {
		now = r.lastTS
	}
	r.lastTS = now
	return now
}

func (r *Recorder) enqueue(c Change) {
	if len(r.pending) >= r.o.MaxBuffer {
		r.dropped++
		return
	}
	r.pending = append(r.pending, c)
	if len(r.pending) >= r.o.FlushRows {
		select {
		case r.kick <- struct{}{}:
		default:
		}
	}
}

func unionFields(a, b []FieldChange, more int) ([]FieldChange, int) {
	have := map[string]bool{}
	for _, f := range a {
		have[f.Path] = true
	}
	out := append([]FieldChange(nil), a...)
	for _, f := range b {
		if !have[f.Path] {
			have[f.Path] = true
			out = append(out, f)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	if len(out) > maxDiffFields {
		more += len(out) - maxDiffFields
		out = out[:maxDiffFields]
	}
	return out, more
}

func intOf(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

// eventChange fills c from a core Event. An update counts only when the
// event occurred again. The message is redacted, then cut, so a credential
// straddling the cut cannot survive.
func (r *Recorder) eventChange(c *Change, ob Observed, e map[string]any) bool {
	switch ob.Op {
	case OpAdd:
	case OpUpdate:
		if intOf(ob.New["count"]) <= intOf(ob.Old["count"]) {
			return false
		}
	default:
		return false
	}
	md := meta(e)
	msg, _ := redact.String(str(e, "message"))
	if rs := []rune(msg); len(rs) > MaxMessage {
		msg = string(rs[:MaxMessage])
	}
	inv, _ := e["involvedObject"].(map[string]any)
	src, _ := e["source"].(map[string]any)
	c.Op = OpEvent
	c.Namespace, c.Name, c.UID = str(md, "namespace"), str(md, "name"), str(md, "uid")
	c.Reason, c.Type, c.Message = str(e, "reason"), str(e, "type"), msg
	c.FieldManager = str(src, "component")
	c.InvolvedKind, c.InvolvedName = str(inv, "kind"), str(inv, "name")
	for _, k := range []string{"lastTimestamp", "eventTime"} {
		if t, err := time.Parse(time.RFC3339, str(e, k)); err == nil {
			t = t.UTC()
			c.ObjTime = &t
			break
		}
	}
	return true
}

// WatchStart notes a watch of kind in namespace ("" = all) beginning.
// Several watches over one kind (full and metadata-only) share one span.
func (r *Recorder) WatchStart(cluster, kind, ns string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := watchKey{cluster, kind, ns}
	if o := r.open[k]; o != nil {
		o.count++
		return
	}
	now := r.o.Now()
	r.open[k] = &openSpan{count: 1, span: Span{Cluster: cluster, Kind: kind, Namespace: ns, Start: now, End: now}}
}

// WatchEnd notes one watch ending; the span closes with reason when the last
// one does.
func (r *Recorder) WatchEnd(cluster, kind, ns, reason string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := watchKey{cluster, kind, ns}
	o := r.open[k]
	if o == nil {
		return
	}
	if o.count--; o.count > 0 {
		return
	}
	o.span.End, o.span.Reason = r.o.Now(), reason
	r.closed = append(r.closed, o.span)
	delete(r.open, k)
}

// Flush writes buffered rows in one batch, releases merged rows whose
// window has passed, and advances every open span's end (its heartbeat).
func (r *Recorder) Flush() error { return r.flush(false) }

func (r *Recorder) flush(final bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.o.Now()
	for k, b := range r.bursts {
		if final || now.Sub(b.lastSeen) >= r.o.MergeWindow {
			if b.held != nil {
				r.enqueue(*b.held)
			}
			delete(r.bursts, k)
		} else if b.held != nil && now.Sub(b.heldSince) >= maxHoldWindows*r.o.MergeWindow {
			r.enqueue(*b.held)
			b.held = nil
		}
	}
	for k, o := range r.open {
		if now.Sub(o.span.End) > pausedAfter*r.o.FlushEvery {
			// Nothing ran between the last heartbeat and now (the machine
			// slept, or the process was stopped), so that time was not
			// watched: close the span where it was last seen alive and
			// open a new one now.
			o.span.Reason = reasonPaused
			r.closed = append(r.closed, o.span)
			o.span = Span{Cluster: k.cluster, Kind: k.kind, Namespace: k.ns, Start: now, End: now}
		}
	}
	if final {
		for k, o := range r.open {
			o.span.End, o.span.Reason = now, reasonAppClosed
			r.closed = append(r.closed, o.span)
			delete(r.open, k)
		}
	}
	spans := append([]Span(nil), r.closed...)
	for _, o := range r.open {
		o.span.End = now
		spans = append(spans, o.span)
	}
	var firstErr error
	if len(spans) > 0 {
		if err := r.st.PutSpans(spans); err != nil {
			firstErr = err
		} else {
			r.closed = nil
		}
	}
	if len(r.pending) > 0 {
		if err := r.st.Append(r.pending); err != nil {
			if firstErr == nil {
				firstErr = err
			}
		} else {
			r.pending = nil
		}
	}
	if firstErr != nil {
		r.lastErr = firstErr.Error()
	} else {
		r.lastErr = ""
	}
	return firstErr
}

// Close writes everything held and closes open spans as "app closed". It
// leaves the store to its owner.
func (r *Recorder) Close() error { return r.flush(true) }
