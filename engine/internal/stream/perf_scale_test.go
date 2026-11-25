package stream

import (
	"bytes"
	"reflect"
	"runtime"
	"testing"

	"github.com/vmihailenco/msgpack/v5"

	"github.com/RajaSardar/kubebay/engine/internal/perffixture"
)

const subscribers = 10

func podOps(n int) []Op {
	ops := make([]Op, n)
	for i := range ops {
		p := perffixture.Pod(i)
		k, _ := ObjectKey(p)
		ops[i] = Op{Op: OpModify, Key: k, Obj: p}
	}
	return ops
}

func sharedPodOps(n int) []Op {
	ops := podOps(n)
	for i := range ops {
		ops[i] = SharedOp(ops[i].Op, ops[i].Key, ops[i].Obj)
	}
	return ops
}

// One pod update reaching 10 subscriptions, each encoding it on its own
// (how every frame was built before the shared encoding).
func BenchmarkEncodeOnePodTenSubs(b *testing.B) {
	ops := podOps(1)
	b.ReportAllocs()
	var n int
	for i := 0; i < b.N; i++ {
		for s := 0; s < subscribers; s++ {
			buf, _ := EncodeData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops})
			n = len(buf)
		}
	}
	b.ReportMetric(float64(n), "frameBytes")
}

// The same with the op from the fanout: the object is encoded once and each
// subscription's frame is written into a pooled buffer.
func BenchmarkEncodeSharedPodTenSubs(b *testing.B) {
	pod := podOps(1)[0]
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		ops := []Op{SharedOp(pod.Op, pod.Key, pod.Obj)}
		for s := 0; s < subscribers; s++ {
			_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops}, func([]byte) error { return nil })
		}
	}
}

// A flush of 7 pods (2,000 pods each writing every 5 s, 16 ms coalescing)
// to 10 subscriptions.
func BenchmarkEncodeFlush7PodsTenSubs(b *testing.B) {
	ops := podOps(7)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		for s := 0; s < subscribers; s++ {
			_, _ = EncodeData(&DataFrame{Type: TypeDelta, ID: "sub", Ops: ops})
		}
	}
}

func BenchmarkEncodeSharedFlush7PodsTenSubs(b *testing.B) {
	pods := podOps(7)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		ops := make([]Op, len(pods))
		for j, p := range pods {
			ops[j] = SharedOp(p.Op, p.Key, p.Obj)
		}
		for s := 0; s < subscribers; s++ {
			_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "sub", Ops: ops}, func([]byte) error { return nil })
		}
	}
}

func decodeAny(t *testing.T, b []byte) any {
	t.Helper()
	var v any
	if err := msgpack.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// The frames on the wire are what they were: same length, same decoded
// content, for every frame shape the hub sends.
func TestSharedOpFramesMatchPlainEncoding(t *testing.T) {
	plain := podOps(3)
	plain = append(plain, Op{Op: OpDelete, Key: "ns/gone"}, Op{Op: OpModify, Key: "ns/empty", Obj: map[string]any{}})
	shared := make([]Op, len(plain))
	for i, o := range plain {
		shared[i] = SharedOp(o.Op, o.Key, o.Obj)
	}
	frames := []func(ops []Op) *DataFrame{
		func(ops []Op) *DataFrame { return &DataFrame{Type: TypeDelta, ID: "s1", RV: "1001", Ops: ops} },
		func(ops []Op) *DataFrame { return &DataFrame{Type: TypeItems, ID: "s2", Ops: ops} },
		func([]Op) *DataFrame { return &DataFrame{Type: TypeBegin, ID: "s3"} },
		func([]Op) *DataFrame { return &DataFrame{Type: TypeChanData, ID: "c", Data: []byte("log line\n")} },
		func([]Op) *DataFrame { return &DataFrame{Type: TypeDelta, ID: "", Meta: map[string]any{"n": int64(3)}} },
		func(ops []Op) *DataFrame {
			return &DataFrame{Type: TypeItems, ID: "all", RV: "9", Ops: ops, Data: []byte{1}, Meta: map[string]any{"k": "v"}}
		},
	}
	for i, mk := range frames {
		want, err := EncodeData(mk(plain))
		if err != nil {
			t.Fatal(err)
		}
		for s := 0; s < 3; s++ { // the second and third use the cached bytes
			var got []byte
			if err := withEncodedData(mk(shared), func(b []byte) error { got = bytes.Clone(b); return nil }); err != nil {
				t.Fatal(err)
			}
			if len(got) != len(want) || !reflect.DeepEqual(decodeAny(t, got), decodeAny(t, want)) {
				t.Fatalf("frame %d, subscription %d: %d bytes, want %d with the same content", i, s, len(got), len(want))
			}
			df, err := DecodeData(got)
			if err != nil || len(df.Ops) != len(mk(plain).Ops) {
				t.Fatalf("frame %d does not decode as a DataFrame: %v", i, err)
			}
		}
	}
}

// The coalescer turns an add into a modify on a copy of the op; the copy
// still shares the one encoding.
func TestSharedOpCopiesShareOneEncoding(t *testing.T) {
	op := sharedPodOps(1)[0]
	cp := op
	cp.Op = OpAdd
	a, err := op.encodedObj()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := cp.encodedObj()
	if &a[0] != &b[0] {
		t.Fatal("a copy of a shared op encoded its object again")
	}
}

// Allocation budget for one pod update reaching 10 subscriptions. Before the
// shared encoding (measured on main): 166 KB and 160 allocations. The
// ceilings are counts over many runs, not timings.
func TestSharedEncodingAllocationBudget(t *testing.T) {
	if raceEnabled {
		t.Skip("the race detector drops pooled buffers at random; the budget is checked in normal builds (CI)")
	}
	pod := podOps(1)[0]
	run := func() {
		ops := []Op{SharedOp(pod.Op, pod.Key, pod.Obj)}
		for s := 0; s < subscribers; s++ {
			_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops}, func([]byte) error { return nil })
		}
	}
	run() // warm the pools
	if n := testing.AllocsPerRun(100, run); n > 6 {
		t.Errorf("one pod to 10 subscriptions: %.0f allocs, budget 6 (was 160)", n)
	}
	// The object's encoding is kept at its own size (a 5.8 KB frame), not in
	// the doubled slice msgpack.Marshal grows (16.5 KB).
	if per := bytesPerRun(200, run); per > 8<<10 {
		t.Errorf("one pod to 10 subscriptions: %d B allocated, budget 8 KiB (was 166 KB, then 16.5 KB)", per)
	}
}

// Subscriptions send on their own goroutines; the first to send a shared op
// encodes it and the rest wait for and reuse those bytes (run with -race).
func TestSharedOpConcurrentSends(t *testing.T) {
	op := sharedPodOps(1)[0]
	want, _ := EncodeData(&DataFrame{Type: TypeDelta, ID: "s", Ops: []Op{{Op: op.Op, Key: op.Key, Obj: op.Obj}}})
	done := make(chan int, subscribers)
	for s := 0; s < subscribers; s++ {
		go func() {
			n := 0
			_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "s", Ops: []Op{op}}, func(b []byte) error { n = len(b); return nil })
			done <- n
		}()
	}
	for s := 0; s < subscribers; s++ {
		if n := <-done; n != len(want) {
			t.Fatalf("frame %d bytes, want %d", n, len(want))
		}
	}
}

// plainOp and plainFrame are Op and DataFrame with no custom encoder: what
// msgpack's reflection writes for them, field by field. The wire format is
// pinned to these, byte for byte.
type plainOp struct {
	Op  string         `msgpack:"op"`
	Key string         `msgpack:"key"`
	Obj map[string]any `msgpack:"obj,omitempty"`
}

type plainFrame struct {
	Type string         `msgpack:"type"`
	ID   string         `msgpack:"id"`
	RV   string         `msgpack:"rv,omitempty"`
	Ops  []plainOp      `msgpack:"ops,omitempty"`
	Data []byte         `msgpack:"data,omitempty"`
	Meta map[string]any `msgpack:"meta,omitempty"`
}

func plainOf(f *DataFrame) *plainFrame {
	p := &plainFrame{Type: f.Type, ID: f.ID, RV: f.RV, Data: f.Data, Meta: f.Meta}
	for _, o := range f.Ops {
		p.Ops = append(p.Ops, plainOp{Op: o.Op, Key: o.Key, Obj: o.Obj})
	}
	return p
}

// Every frame shape, through both the pooled writer and EncodeData, with
// shared and plain ops, is byte for byte what reflection writes for the
// same frame. Objects and meta have one key per map so the bytes do not
// depend on map order.
func TestFramesMatchReflectionByteForByte(t *testing.T) {
	obj := func(name string) map[string]any {
		return map[string]any{"metadata": map[string]any{"name": name}}
	}
	plain := []Op{
		{Op: OpAdd, Key: "ns/a", Obj: obj("a")},
		{Op: OpModify, Key: "ns/b", Obj: map[string]any{"n": int64(7)}},
		{Op: OpDelete, Key: "ns/gone"},
		{Op: OpModify, Key: "ns/empty", Obj: map[string]any{}},
	}
	shared := make([]Op, len(plain))
	for i, o := range plain {
		shared[i] = SharedOp(o.Op, o.Key, o.Obj)
	}
	frames := []func(ops []Op) *DataFrame{
		func(ops []Op) *DataFrame { return &DataFrame{Type: TypeDelta, ID: "s1", RV: "1001", Ops: ops} },
		func(ops []Op) *DataFrame { return &DataFrame{Type: TypeItems, ID: "s2", Ops: ops} },
		func([]Op) *DataFrame { return &DataFrame{Type: TypeBegin, ID: "s3"} },
		func([]Op) *DataFrame { return &DataFrame{Type: TypeChanData, ID: "c", Data: []byte("log line\n")} },
		func([]Op) *DataFrame { return &DataFrame{Type: TypeDelta, Meta: map[string]any{"n": int64(3)}} },
		func(ops []Op) *DataFrame {
			return &DataFrame{Type: TypeItems, ID: "all", RV: "9", Ops: ops, Data: []byte{1}, Meta: map[string]any{"k": "v"}}
		},
	}
	for i, mk := range frames {
		want, err := msgpack.Marshal(plainOf(mk(plain)))
		if err != nil {
			t.Fatal(err)
		}
		for name, ops := range map[string][]Op{"plain": plain, "shared": shared} {
			for s := 0; s < 2; s++ { // the second send of a shared op uses its cached bytes
				var got []byte
				if err := withEncodedData(mk(ops), func(b []byte) error { got = bytes.Clone(b); return nil }); err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(got, want) {
					t.Fatalf("frame %d, %s ops, send %d (pooled writer):\n got %x\nwant %x", i, name, s, got, want)
				}
				viaEncodeData, err := EncodeData(mk(ops))
				if err != nil || !bytes.Equal(viaEncodeData, want) {
					t.Fatalf("frame %d, %s ops (EncodeData):\n got %x\nwant %x (%v)", i, name, viaEncodeData, want, err)
				}
			}
		}
	}
}

// Ten subscriptions each writing a plain op into the pooled buffer: no
// garbage, but the object is encoded ten times.
func BenchmarkEncodePlainPodTenSubsPooled(b *testing.B) {
	ops := podOps(1)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		for s := 0; s < subscribers; s++ {
			_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops}, func([]byte) error { return nil })
		}
	}
}

// One pod update to a single subscription, the most common case: before the
// shared encoding, through EncodeData.
func BenchmarkEncodeOnePodOneSub(b *testing.B) {
	ops := podOps(1)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = EncodeData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops})
	}
}

// The same as a shared op: its object is encoded into its own slice first.
func BenchmarkEncodeSharedPodOneSub(b *testing.B) {
	pod := podOps(1)[0]
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		ops := []Op{SharedOp(pod.Op, pod.Key, pod.Obj)}
		_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops}, func([]byte) error { return nil })
	}
}

// The same as a plain op written straight into the pooled buffer.
func BenchmarkEncodePlainPodOneSubPooled(b *testing.B) {
	ops := podOps(1)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops}, func([]byte) error { return nil })
	}
}

// bytesPerRun is what f allocates per run, on one P with the GC settled, so
// the figure is f's and not another goroutine's.
func bytesPerRun(runs int, f func()) uint64 {
	defer runtime.GOMAXPROCS(runtime.GOMAXPROCS(1))
	f()
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	for i := 0; i < runs; i++ {
		f()
	}
	runtime.ReadMemStats(&after)
	return (after.TotalAlloc - before.TotalAlloc) / uint64(runs)
}

// A pod update reaching one subscription is sent as a plain op written into
// the pooled buffer: no separate encoding of the object.
func TestSingleSubscriptionAllocationBudget(t *testing.T) {
	if raceEnabled {
		t.Skip("the race detector drops pooled buffers at random; the budget is checked in normal builds (CI)")
	}
	ops := podOps(1)
	run := func() {
		_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops}, func([]byte) error { return nil })
	}
	run()
	n := testing.AllocsPerRun(100, run)
	per := bytesPerRun(200, run)
	t.Logf("one pod to one subscription, plain op, pooled buffer: %.0f allocs, %d B", n, per)
	if n > 1 {
		t.Errorf("one pod to one subscription: %.0f allocs, budget 1 (a shared op made 11)", n)
	}
	if per > 4<<10 {
		t.Errorf("one pod to one subscription: %d B allocated, budget 4 KiB", per)
	}
}

// A 200-object snapshot frame (itemsPerFrame) fits the pooled buffer cap, so
// the largest frames the hub sends are the ones whose buffers are reused.
func TestSnapshotFrameFitsThePooledBuffer(t *testing.T) {
	ops := podOps(itemsPerFrame)
	var size, capacity int
	for s := 0; s < 2; s++ {
		_ = withEncodedData(&DataFrame{Type: TypeItems, ID: "sub", Ops: ops}, func(b []byte) error { size = len(b); return nil })
	}
	buf := frameBufs.Get().(*bytes.Buffer)
	capacity = buf.Cap()
	frameBufs.Put(buf)
	t.Logf("%d-pod snapshot frame: %d B, pooled buffer cap %d B, limit %d B", itemsPerFrame, size, capacity, maxPooledFrame)
	if 2*size > maxPooledFrame {
		t.Errorf("a %d-pod frame is %d B: a buffer grown to hold it (up to 2x) may pass maxPooledFrame %d and not be reused", itemsPerFrame, size, maxPooledFrame)
	}
}

// A 2,000-pod snapshot sent to one subscription, frame by frame as the hub
// sends it. Each subscription's snapshot is encoded on its own: they are
// taken at different times, and sharing them would mean holding encoded
// bytes for every cached object.
func BenchmarkEncodeSnapshot2000Pods(b *testing.B) {
	snap := OpsSnapshot(podOps(2000))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for ops := range snap.Frames(itemsPerFrame) {
			_ = withEncodedData(&DataFrame{Type: TypeItems, ID: "sub", Ops: ops}, func([]byte) error { return nil })
		}
	}
}
