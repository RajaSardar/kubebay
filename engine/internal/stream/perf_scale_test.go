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
// shared encoding: 166 KB and 160 allocations; after: 16.5 KB and 11. The
// ceilings are counts over many runs, not timings.
func TestSharedEncodingAllocationBudget(t *testing.T) {
	pod := podOps(1)[0]
	run := func() {
		ops := []Op{SharedOp(pod.Op, pod.Key, pod.Obj)}
		for s := 0; s < subscribers; s++ {
			_ = withEncodedData(&DataFrame{Type: TypeDelta, ID: "sub", RV: "1001", Ops: ops}, func([]byte) error { return nil })
		}
	}
	run() // warm the pools
	if n := testing.AllocsPerRun(100, run); n > 25 {
		t.Errorf("one pod to 10 subscriptions: %.0f allocs, budget 25 (was 160)", n)
	}
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	const runs = 200
	for i := 0; i < runs; i++ {
		run()
	}
	runtime.ReadMemStats(&after)
	if per := (after.TotalAlloc - before.TotalAlloc) / runs; per > 32<<10 {
		t.Errorf("one pod to 10 subscriptions: %d B allocated, budget 32 KiB (was 166 KB)", per)
	}
}
