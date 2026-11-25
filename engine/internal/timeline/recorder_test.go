package timeline

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *fakeClock) Set(t time.Time)     { c.mu.Lock(); c.t = t; c.mu.Unlock() }
func (c *fakeClock) Add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

// countingStore counts Append calls so batching can be asserted.
type countingStore struct {
	*MemStore
	appends int
}

func (c *countingStore) Append(rows []Change) error { c.appends++; return c.MemStore.Append(rows) }

func newRec(t *testing.T, o Options) (*Recorder, *countingStore, *fakeClock) {
	t.Helper()
	clk := &fakeClock{t: t0}
	st := &countingStore{MemStore: NewMemStore()}
	o.Now = clk.Now
	return NewRecorder(st, o), st, clk
}

func deploy(rv string, replicas int, mgr string, mgrTime string) map[string]any {
	return map[string]any{"apiVersion": "apps/v1", "kind": "Deployment",
		"metadata": map[string]any{"name": "web", "namespace": "ns", "uid": "u-web", "resourceVersion": rv,
			"managedFields": []any{map[string]any{"manager": mgr, "operation": "Update", "time": mgrTime}}},
		"spec": map[string]any{"replicas": replicas}}
}

func upd(old, nw map[string]any) Observed {
	return Observed{Group: "apps", Version: "v1", Resource: "deployments", ObjKind: "Deployment", Op: OpUpdate, Old: old, New: nw}
}

func rowsOf(t *testing.T, st Store) []Change {
	t.Helper()
	p, err := st.Query(Query{Cluster: "c1", Limit: MaxQueryLimit})
	if err != nil {
		t.Fatal(err)
	}
	return p.Changes
}

func TestRecorderStoresPathsAndTheManagerNeverValues(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	r.Observe("c1", upd(deploy("1", 1, "kubectl", "2026-03-01T10:00:00Z"), deploy("2", 3, "argocd", "2026-03-01T12:00:00Z")))
	if err := r.Flush(); err != nil {
		t.Fatal(err)
	}
	got := rowsOf(t, st)
	if len(got) != 1 {
		t.Fatalf("rows: %d", len(got))
	}
	c := got[0]
	if c.Kind != "Deployment" || c.Namespace != "ns" || c.Name != "web" || c.Op != OpUpdate || c.FieldManager != "argocd" {
		t.Errorf("%+v", c)
	}
	if len(c.Fields) != 1 || c.Fields[0].Path != "spec.replicas" {
		t.Errorf("fields: %+v", c.Fields)
	}
	if c.ObjTime == nil || c.ObjTime.Hour() != 12 {
		t.Errorf("objTime: %v", c.ObjTime)
	}
	if !c.TS.Equal(t0) {
		t.Errorf("ts is observation time: %v", c.TS)
	}
}

func TestRecorderNeverObservesSecrets(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	secret := map[string]any{"kind": "Secret", "metadata": map[string]any{"name": "s", "namespace": "ns", "uid": "u", "resourceVersion": "2"}, "data": map[string]any{"password": "aHVudGVyMg=="}}
	for _, o := range []Observed{
		{Resource: "secrets", ObjKind: "Secret", Op: OpAdd, New: secret},
		{Resource: "secrets", ObjKind: "Secret", Op: OpUpdate, Old: secret, New: secret},
		{Resource: "secrets", ObjKind: "PartialObjectMetadata", Op: OpDelete, Old: secret},
		{Group: "example.com", Resource: "things", ObjKind: "Secret", Op: OpAdd, New: secret},
	} {
		r.Observe("c1", o)
	}
	_ = r.Flush()
	if got := rowsOf(t, st); len(got) != 0 {
		t.Errorf("a Secret was recorded: %+v", got)
	}
}

func TestRecorderDropsNoise(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	a := deploy("1", 1, "kubectl", "2026-03-01T10:00:00Z")
	r.Observe("c1", upd(a, a))                                                                                                                          // resync: same resourceVersion
	r.Observe("c1", upd(a, deploy("2", 1, "kubectl", "2026-03-01T10:00:00Z")))                                                                          // nothing but resourceVersion
	r.Observe("c1", Observed{Resource: "leases", Group: "coordination.k8s.io", Op: OpUpdate, Old: a, New: deploy("9", 1, "x", "2026-03-01T10:00:00Z")}) // denied kind
	_ = r.Flush()
	if got := rowsOf(t, st); len(got) != 0 {
		t.Errorf("noise recorded: %+v", got)
	}
}

func TestRecorderAHeartbeatStormMakesAHandfulOfRows(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	node := func(i int) map[string]any {
		return map[string]any{"kind": "Node", "metadata": map[string]any{"name": "n1", "uid": "u-n1", "resourceVersion": fmt.Sprint(i)},
			"status": map[string]any{"conditions": []any{map[string]any{"type": "Ready", "status": "True", "lastHeartbeatTime": fmt.Sprint(i)}}}}
	}
	for i := 1; i <= 1000; i++ {
		clk.Add(time.Second / 10)
		r.Observe("c1", Observed{Resource: "nodes", ObjKind: "Node", Op: OpUpdate, Old: node(i), New: node(i + 1)})
	}
	_ = r.Flush()
	if got := rowsOf(t, st); len(got) > 3 {
		t.Errorf("%d rows from a heartbeat storm", len(got))
	}
}

func TestRecorderIgnoresTheSameChangeSeenTwice(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	o := upd(deploy("1", 1, "k", "2026-03-01T10:00:00Z"), deploy("2", 2, "k", "2026-03-01T10:01:00Z"))
	r.Observe("c1", o) // the full watch
	md := o
	md.MetadataOnly = true
	r.Observe("c1", md) // a metadata watch of the same kind saw it too
	_ = r.Flush()
	if got := rowsOf(t, st); len(got) != 1 {
		t.Errorf("%d rows for one change", len(got))
	}
}

func TestRecorderWritesOneBatchPerFlush(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	for i := 0; i < 50; i++ {
		o := upd(deploy(fmt.Sprint(i*2), 1, "k", "2026-03-01T10:00:00Z"), deploy(fmt.Sprint(i*2+1), 2+i, "k", "2026-03-01T10:01:00Z"))
		o.New["metadata"].(map[string]any)["uid"] = fmt.Sprintf("u%d", i)
		o.Old["metadata"].(map[string]any)["uid"] = fmt.Sprintf("u%d", i)
		r.Observe("c1", o)
	}
	if st.appends != 0 {
		t.Errorf("wrote before the flush: %d", st.appends)
	}
	_ = r.Flush()
	if st.appends != 1 || len(rowsOf(t, st)) != 50 {
		t.Errorf("appends %d rows %d", st.appends, len(rowsOf(t, st)))
	}
	_ = r.Flush()
	if st.appends != 1 {
		t.Error("an empty flush wrote")
	}
}

func TestRecorderDropsAndCountsWhenTheBufferIsFull(t *testing.T) {
	r, st, _ := newRec(t, Options{MaxBuffer: 10})
	for i := 0; i < 25; i++ {
		o := upd(deploy("1", 1, "k", "2026-03-01T10:00:00Z"), deploy(fmt.Sprint(i+2), 2, "k", "2026-03-01T10:01:00Z"))
		o.New["metadata"].(map[string]any)["uid"] = fmt.Sprintf("u%d", i)
		r.Observe("c1", o)
	}
	_ = r.Flush()
	if got := len(rowsOf(t, st)); got != 10 {
		t.Errorf("kept %d", got)
	}
	if s := r.Status(); s.Dropped != 15 {
		t.Errorf("dropped = %d", s.Dropped)
	}
}

func TestRecorderMergesBurstsOnOneObject(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	prev := deploy("1", 1, "k", "2026-03-01T10:00:00Z")
	for i := 2; i <= 6; i++ {
		clk.Add(2 * time.Second)
		next := deploy(fmt.Sprint(i), i, "k", fmt.Sprintf("2026-03-01T10:00:%02dZ", i))
		if i == 4 {
			next["spec"].(map[string]any)["paused"] = true
		}
		r.Observe("c1", upd(prev, next))
		prev = next
	}
	_ = r.Flush()
	if got := len(rowsOf(t, st)); got != 1 {
		t.Fatalf("the first change shows at once: %d rows", got)
	}
	clk.Add(31 * time.Second)
	_ = r.Flush()
	rows := rowsOf(t, st)
	if len(rows) != 2 {
		t.Fatalf("burst should be one more row, got %d", len(rows))
	}
	merged := rows[0]
	if merged.Merged != 4 {
		t.Errorf("merged = %d", merged.Merged)
	}
	var sawPaused bool
	for _, f := range merged.Fields {
		if f.Path == "spec.paused" {
			sawPaused = true
		}
	}
	if !sawPaused {
		t.Errorf("the union of paths is lost: %+v", merged.Fields)
	}
}

func TestRecorderTimestampsNeverGoBackwards(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	r.Observe("c1", upd(deploy("1", 1, "k", "2026-03-01T10:00:00Z"), deploy("2", 2, "k", "2026-03-01T10:01:00Z")))
	clk.Set(t0.Add(-time.Hour)) // the wall clock jumps back
	o := upd(deploy("2", 2, "k", "2026-03-01T10:01:00Z"), deploy("3", 3, "k", "2026-03-01T10:02:00Z"))
	o.New["metadata"].(map[string]any)["uid"] = "other"
	r.Observe("c1", o)
	_ = r.Flush()
	rows := rowsOf(t, st)
	if len(rows) != 2 || rows[0].TS.Before(rows[1].TS) {
		t.Errorf("clock jump reordered rows: %v %v", rows[0].TS, rows[1].TS)
	}
}

func TestRecorderFlagsMetadataOnlyAndRelist(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	o := upd(deploy("1", 1, "k", "2026-03-01T10:00:00Z"), deploy("2", 2, "k", "2026-03-01T10:01:00Z"))
	o.MetadataOnly, o.AfterGap = true, true
	r.Observe("c1", o)
	del := Observed{Resource: "pods", ObjKind: "Pod", Op: OpDelete, AfterGap: true, Old: map[string]any{"metadata": map[string]any{"name": "p", "namespace": "ns", "uid": "up", "resourceVersion": "5"}}}
	r.Observe("c1", del)
	_ = r.Flush()
	for _, c := range rowsOf(t, st) {
		if !c.AfterGap {
			t.Errorf("%s not flagged after a gap", c.Name)
		}
		if c.Name == "web" && !c.MetadataOnly {
			t.Error("metadata-only watch not flagged")
		}
		if c.Name == "web" && c.FieldManager != "" {
			t.Errorf("a change after a relist is attributed to %q", c.FieldManager)
		}
		if c.Op == OpDelete && c.Kind != "Pod" {
			t.Errorf("delete kind %q", c.Kind)
		}
	}
}

func eventObj(rv, msg string, count int64) map[string]any {
	return map[string]any{"kind": "Event", "type": "Warning", "reason": "BackOff", "message": msg, "count": count,
		"lastTimestamp": "2026-03-01T10:00:05Z", "source": map[string]any{"component": "kubelet"},
		"involvedObject": map[string]any{"kind": "Pod", "name": "web-1", "namespace": "ns"},
		"metadata":       map[string]any{"name": "web-1.abc", "namespace": "ns", "uid": "ue", "resourceVersion": rv}}
}

func TestRecorderRecordsEventsWithRedactionBeforeTruncation(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	token := "ghp_" + strings.Repeat("A1b2C3d4E5", 4) // 44 chars
	msg := strings.Repeat("x", MaxMessage-10) + " token=" + token + " tail"
	r.Observe("c1", Observed{Resource: "events", ObjKind: "Event", Op: OpAdd, New: eventObj("1", msg, 1)})
	_ = r.Flush()
	got := rowsOf(t, st)
	if len(got) != 1 {
		t.Fatalf("%d rows", len(got))
	}
	e := got[0]
	if e.Op != OpEvent || e.Kind != "Event" || e.Reason != "BackOff" || e.Type != "Warning" || e.FieldManager != "kubelet" || e.InvolvedKind != "Pod" || e.InvolvedName != "web-1" {
		t.Errorf("%+v", e)
	}
	if len([]rune(e.Message)) > MaxMessage {
		t.Errorf("message not truncated: %d", len(e.Message))
	}
	if strings.Contains(e.Message, "ghp_") || strings.Contains(e.Message, "A1b2C3d4") {
		t.Errorf("a token straddling the cut survived: %q", e.Message[len(e.Message)-40:])
	}
}

func TestRecorderEventUpdatesOnlyWhenTheCountMoves(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	r.Observe("c1", Observed{Resource: "events", ObjKind: "Event", Op: OpAdd, New: eventObj("1", "m", 1)})
	r.Observe("c1", Observed{Resource: "events", ObjKind: "Event", Op: OpUpdate, Old: eventObj("1", "m", 1), New: eventObj("2", "m", 1)})
	_ = r.Flush()
	if got := len(rowsOf(t, st)); got != 1 {
		t.Errorf("an update with no new occurrence was recorded: %d", got)
	}
	r.Observe("c1", Observed{Resource: "events", ObjKind: "Event", Op: OpUpdate, Old: eventObj("2", "m", 1), New: eventObj("3", "m", 2)})
	_ = r.Flush()
	if got := len(rowsOf(t, st)); got != 2 {
		t.Errorf("a new occurrence was not recorded: %d", got)
	}
}

func TestRecorderCoverageFollowsTheWatches(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	r.WatchStart("c1", "Pod", "")
	r.WatchStart("c1", "Pod", "") // a second informer (the other mode) over the same kind
	clk.Add(10 * time.Second)
	_ = r.Flush()
	clk.Add(10 * time.Second)
	r.WatchEnd("c1", "Pod", "", "watch stopped")
	_ = r.Flush()
	sp, _ := st.Spans("c1", "Pod", t0.Add(-time.Hour), t0.Add(time.Hour))
	if len(sp) != 1 || !sp[0].End.Equal(t0.Add(20*time.Second)) && sp[0].Reason != "" {
		// still open after one WatchEnd: the end is the last flush
		t.Errorf("after one of two watches ended: %+v", sp)
	}
	if sp[0].Reason != "" {
		t.Errorf("closed while another watch still ran: %+v", sp[0])
	}
	clk.Add(10 * time.Second)
	r.WatchEnd("c1", "Pod", "", "watch stopped")
	_ = r.Flush()
	sp, _ = st.Spans("c1", "Pod", t0.Add(-time.Hour), t0.Add(time.Hour))
	if len(sp) != 1 || sp[0].Reason != "watch stopped" || !sp[0].End.Equal(t0.Add(30*time.Second)) {
		t.Errorf("after both ended: %+v", sp)
	}
	gaps := Gaps(sp, t0, t0.Add(time.Minute), 0)
	if len(gaps) != 1 || gaps[0].Reason != "watch stopped" {
		t.Errorf("gap: %+v", gaps)
	}
}

func TestRecorderOpenSpansAdvanceEveryFlushAndCloseOnShutdown(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	r.WatchStart("c1", "Node", "")
	clk.Add(4 * time.Second)
	_ = r.Flush()
	sp, _ := st.Spans("c1", "Node", t0.Add(-time.Hour), t0.Add(time.Hour))
	if len(sp) != 1 || !sp[0].End.Equal(t0.Add(4*time.Second)) {
		t.Errorf("heartbeat: %+v", sp)
	}
	clk.Add(4 * time.Second)
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	sp, _ = st.Spans("c1", "Node", t0.Add(-time.Hour), t0.Add(time.Hour))
	if len(sp) != 1 || sp[0].Reason != "app closed" || !sp[0].End.Equal(t0.Add(8*time.Second)) {
		t.Errorf("shutdown: %+v", sp)
	}
}

func TestRecorderCloseWritesWhatIsBuffered(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	prev := deploy("1", 1, "k", "2026-03-01T10:00:00Z")
	r.Observe("c1", upd(prev, deploy("2", 2, "k", "2026-03-01T10:00:01Z")))
	clk.Add(time.Second)
	r.Observe("c1", upd(deploy("2", 2, "k", "2026-03-01T10:00:01Z"), deploy("3", 3, "k", "2026-03-01T10:00:02Z")))
	_ = r.Close()
	if got := len(rowsOf(t, st)); got != 2 {
		t.Errorf("rows after close: %d (the held merge row must be written too)", got)
	}
}

func TestRecorderSkipsEventsSeenOnlyThroughAMetadataWatch(t *testing.T) {
	r, st, _ := newRec(t, Options{})
	r.Observe("c1", Observed{Resource: "events", ObjKind: "PartialObjectMetadata", Op: OpAdd, MetadataOnly: true,
		New: map[string]any{"metadata": map[string]any{"name": "e", "namespace": "ns", "uid": "ue", "resourceVersion": "1"}}})
	_ = r.Flush()
	if got := rowsOf(t, st); len(got) != 0 {
		t.Errorf("an event row with no reason or message was recorded: %+v", got)
	}
}

// A laptop that sleeps for an hour must not have the hour counted as watched:
// the heartbeat only moves a span's end across a normal flush interval.
func TestRecorderSleepIsAGapNotCoverage(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	r.WatchStart("c1", "Node", "")
	clk.Add(2 * time.Second)
	_ = r.Flush()
	clk.Add(time.Hour) // asleep
	_ = r.Flush()
	clk.Add(2 * time.Second)
	_ = r.Flush()
	sp, _ := st.Spans("c1", "Node", t0.Add(-time.Hour), t0.Add(3*time.Hour))
	gaps := Gaps(sp, t0, t0.Add(time.Hour+4*time.Second), 15*time.Second)
	if len(gaps) != 1 {
		t.Fatalf("the sleep must show as one gap, got %+v (spans %+v)", gaps, sp)
	}
	if g := gaps[0]; g.From.After(t0.Add(3*time.Second)) || g.To.Before(t0.Add(time.Hour)) {
		t.Errorf("gap %v..%v does not cover the sleep", g.From, g.To)
	}
}

// An object that updates all the time must still reach the database.
func TestRecorderACeaselessBurstIsStillWritten(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	prev := deploy("1", 1, "k", "2026-03-01T10:00:00Z")
	for i := 2; i <= 400; i++ {
		clk.Add(2 * time.Second) // never quiet for 30s
		next := deploy(fmt.Sprint(i), i, "k", "2026-03-01T10:00:00Z")
		r.Observe("c1", upd(prev, next))
		prev = next
		_ = r.Flush()
	}
	if got := len(rowsOf(t, st)); got < 3 {
		t.Fatalf("13 minutes of constant updates left %d rows in the store", got)
	}
}

func TestRecorderCloseAfterSleepDoesNotCoverTheSleep(t *testing.T) {
	r, st, clk := newRec(t, Options{})
	r.WatchStart("c1", "Node", "")
	clk.Add(2 * time.Second)
	_ = r.Flush()
	clk.Add(time.Hour)
	_ = r.Close()
	sp, _ := st.Spans("c1", "Node", t0.Add(-time.Hour), t0.Add(3*time.Hour))
	if len(Gaps(sp, t0, t0.Add(time.Hour), 15*time.Second)) != 1 {
		t.Fatalf("closing right after a sleep hid it: %+v", sp)
	}
}
