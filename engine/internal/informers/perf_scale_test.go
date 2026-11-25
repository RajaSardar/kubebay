package informers

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	goruntime "runtime"

	"github.com/RajaSardar/kubebay/engine/internal/perffixture"
	"github.com/RajaSardar/kubebay/engine/internal/timeline"
)

func metaPod(i int) *metav1.PartialObjectMetadata {
	u := &unstructured.Unstructured{Object: perffixture.Pod(i)}
	var m metav1.PartialObjectMetadata
	_ = runtime.DefaultUnstructuredConverter.FromUnstructured(map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": u.Object["metadata"]}, &m)
	m.Kind, m.APIVersion = "PartialObjectMetadata", "meta.k8s.io/v1"
	return &m
}

// emit on a full-mode update: the map is the cache's own.
func BenchmarkOpOfFullPod(b *testing.B) {
	u := &unstructured.Unstructured{Object: perffixture.Pod(1)}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = opOf("MODIFIED", u)
	}
}

func storedMetaPod(i int, rv string) any {
	m := metaPod(i)
	m.ResourceVersion = rv
	s, _ := trimManagedFields(m)
	return s
}

// emit on a metadata-mode update (search index, many pages). It was a JSON
// round trip per op: 15 us, 8 KB, 194 allocs.
func BenchmarkOpOfMetadataPod(b *testing.B) {
	m := storedMetaPod(1, "1000")
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = opOf("MODIFIED", m)
	}
}

// The one conversion a metadata object now gets, as it enters the cache.
func BenchmarkMetadataTransformPod(b *testing.B) {
	m := metaPod(1)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = trimManagedFields(m) // the typed object is only trimmed, so it can be converted again
	}
}

// observe on a metadata-mode update. It was old and new each through the
// reflection converter: 15 us, 11.5 KB, 232 allocs.
func BenchmarkToObservedMetadataPod(b *testing.B) {
	o, n := storedMetaPod(1, "1000"), storedMetaPod(1, "1001")
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = toObserved(timeline.OpUpdate, o, n, "", "v1", "pods", ModeMetadata)
	}
}

func BenchmarkTrimManagedFieldsPod(b *testing.B) {
	p := perffixture.Pod(1)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = trimManagedFields(&unstructured.Unstructured{Object: p})
	}
}

// heapLive is the bytes of live objects after a full GC. Only this test's
// own process may be measured: see TestCacheHeap2000Pods.
func heapLive() uint64 {
	var m goruntime.MemStats
	goruntime.GC()
	goruntime.GC()
	goruntime.ReadMemStats(&m)
	return m.HeapAlloc
}

const heapChildEnv = "KUBEBAY_TEST_CACHE_HEAP_CHILD"

// What one cache of 2,000 pods holds, full and metadata-only. The heap is
// the whole process's, so the measuring runs in a fresh copy of the test
// binary: in the package's own process, informers other tests left
// stopping still allocate, and one full-package run in 33 read 25.0 MiB
// for the stored maps against 15 to 18.7 MiB alone.
func TestCacheHeap2000Pods(t *testing.T) {
	if os.Getenv(heapChildEnv) == "1" {
		measureCacheHeap2000Pods(t)
		return
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "-test.run=^TestCacheHeap2000Pods$", "-test.v", "-test.count=1")
	cmd.Env = append(os.Environ(), heapChildEnv+"=1")
	out, err := cmd.CombinedOutput()
	t.Logf("measured in a fresh process:\n%s", out)
	if err != nil {
		t.Fatalf("the measuring process failed: %v", err)
	}
}

func measureCacheHeap2000Pods(t *testing.T) {
	heapInuse := heapLive
	base := heapInuse()
	full := make([]any, 2000)
	for i := range full {
		full[i] = &unstructured.Unstructured{Object: perffixture.Pod(i)}
	}
	mid := heapInuse()
	meta := make([]any, 2000)
	for i := range meta {
		meta[i] = metaPod(i)
	}
	end := heapInuse()
	// what the metadata cache stores now: each object made a map once
	stored := make([]any, 2000)
	for i := range stored {
		stored[i], _ = trimManagedFields(metaPod(i))
	}
	storedEnd := heapInuse()
	// a snapshot of the stored cache made ops: no new maps
	snapOps := make([]any, 2000)
	for i, m := range stored {
		op, _ := opOf("ADDED", m)
		snapOps[i] = op
	}
	after := heapInuse()
	mib := func(a, b uint64) float64 { return float64(int64(b)-int64(a)) / (1 << 20) }
	t.Logf("live bytes: full cache %.1f MiB (%.1f KiB/pod); metadata objects as decoded %.1f MiB; as the cache stores them %.1f MiB; snapshot ops %.1f MiB",
		mib(base, mid), mib(base, mid)*1024/2000, mib(mid, end), mib(end, storedEnd), mib(storedEnd, after))
	// Live bytes, measured: 64 MiB full; a metadata pod stored typed with
	// its field sets trimmed 2.3 MiB, and 9.5 MiB when the transform made
	// it a map (that change was reverted: four times the memory, for every
	// object of every metadata watch, to save 2.6 us per event). Ceilings
	// catch a regression (fieldsV1 or a map kept, say), not noise.
	if got := mib(base, mid); got > 100 {
		t.Errorf("2,000 full pods hold %.1f MiB, budget 100", got)
	}
	if got := mib(end, storedEnd); got > 4 {
		t.Errorf("2,000 stored metadata pods hold %.1f MiB, budget 4 (2.3 typed and trimmed, 9.5 as maps)", got)
	}
	// Ops are made a frame at a time as the hub sends them (see
	// stream.Snapshot); held all at once here, 2,000 of them are the maps.
	if got := mib(storedEnd, after); got > 16 {
		t.Errorf("a 2,000-object metadata snapshot made ops took %.1f MiB, budget 16", got)
	}
	goruntime.KeepAlive(full)
	goruntime.KeepAlive(meta)
	goruntime.KeepAlive(stored)
	goruntime.KeepAlive(snapOps)
}

// What client-go spends turning one watch event's pod JSON into the map.
func BenchmarkDecodeWatchPod(b *testing.B) {
	raw, _ := json.Marshal(perffixture.Pod(1))
	b.SetBytes(int64(len(raw)))
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _, _ = unstructured.UnstructuredJSONScheme.Decode(raw, nil, nil)
	}
}
