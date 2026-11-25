package main

import (
	"math"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"runtime/metrics"
	"strings"
	"testing"
)

// gcRun is what the GC did while a live heap of live bytes stayed reachable
// and churn bytes of garbage were made in 64 KiB pieces.
type gcRun struct {
	cycles   uint64
	liveHeap uint64 // live heap after a GC with the live bytes kept
	peakHeap uint64 // largest heap of live and not yet collected objects seen
	peakGoal uint64 // largest heap goal the GC set
	gcCPU    float64
}

func churnUnderLimit(limit int64, live, churn int) gcRun {
	defer debug.SetMemoryLimit(debug.SetMemoryLimit(limit))
	defer debug.SetGCPercent(debug.SetGCPercent(100))
	const piece = 64 << 10
	runtime.GC()
	samples := []metrics.Sample{
		{Name: "/gc/cycles/total:gc-cycles"},
		{Name: "/memory/classes/heap/objects:bytes"},
		{Name: "/cpu/classes/gc/total:cpu-seconds"},
		{Name: "/gc/heap/goal:bytes"},
	}
	kept := make([][]byte, live/piece)
	for i := range kept {
		kept[i] = make([]byte, piece)
	}
	metrics.Read(samples)
	cycles0, cpu0 := samples[0].Value.Uint64(), samples[2].Value.Float64()
	var r gcRun
	runtime.GC()
	metrics.Read(samples)
	r.liveHeap = samples[1].Value.Uint64()
	var sink []byte
	for i := 0; i < churn/piece; i++ {
		sink = make([]byte, piece)
		sink[0] = byte(i)
		if i%16 == 0 {
			metrics.Read(samples)
			r.peakHeap = max(r.peakHeap, samples[1].Value.Uint64())
			r.peakGoal = max(r.peakGoal, samples[3].Value.Uint64())
		}
	}
	metrics.Read(samples)
	r.cycles = samples[0].Value.Uint64() - cycles0
	r.gcCPU = samples[2].Value.Float64() - cpu0
	runtime.KeepAlive(kept)
	runtime.KeepAlive(sink)
	return r
}

// The trade-off of setting no default memory limit, measured. The engine
// used to set 512 MiB; a large cluster's caches pushed the live heap past it
// (680 MB seen) and the GC ran back to back. Scaled down here: a 32 MiB live
// heap and 320 MiB of garbage, under a limit at half the live heap and with
// none (GOGC=100). Measured (Apple M2, 50 runs, load average 40 to 75): with
// the limit 83 to 132 cycles and 0.11 to 0.20 s of GC CPU, peak heap 44 MiB;
// with none 5 to 12 cycles and 0.01 to 0.02 s, peak heap 86 to 118 MiB (once
// 201) against a 36 MiB live heap. No limit costs memory, 2.4 to 3.3x the
// live heap; a limit below the live heap costs about ten times the GC work.
func TestNoMemoryLimitTradesHeapForGCCycles(t *testing.T) {
	const live, churn = 32 << 20, 320 << 20
	limited := churnUnderLimit(live/2, live, churn)
	unlimited := churnUnderLimit(math.MaxInt64, live, churn)
	mib := func(b uint64) float64 { return float64(b) / (1 << 20) }
	t.Logf("limit 16 MiB: %d GC cycles, live heap %.0f MiB, heap goal %.0f MiB, peak heap %.0f MiB, GC CPU %.3f s", limited.cycles, mib(limited.liveHeap), mib(limited.peakGoal), mib(limited.peakHeap), limited.gcCPU)
	t.Logf("no limit:     %d GC cycles, live heap %.0f MiB, heap goal %.0f MiB, peak heap %.0f MiB, GC CPU %.3f s", unlimited.cycles, mib(unlimited.liveHeap), mib(unlimited.peakGoal), mib(unlimited.peakHeap), unlimited.gcCPU)
	// GOGC=100: a cycle per live heap of garbage, about churn/live of them.
	if unlimited.cycles > 2*churn/live {
		t.Errorf("no limit: %d GC cycles for %d MiB of garbage over a %d MiB heap, want about %d", unlimited.cycles, churn>>20, live>>20, churn/live)
	}
	// The memory paid for that is logged, not checked: it depends on how much
	// garbage is made while a cycle marks, so on how much CPU the GC's
	// workers get. 2.4 to 3.3x the live heap seen, once 5.6x on a loaded host.
	if limited.cycles < 4*unlimited.cycles {
		t.Errorf("a limit below the live heap made %d GC cycles against %d with none: want it to show the thrash it caused", limited.cycles, unlimited.cycles)
	}
}

// Nothing in the engine's startup sets a memory limit of its own: only
// GOMEMLIMIT, which the Go runtime applies before main runs, sets one.
func TestStartupSetsNoMemoryLimit(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "SetMemoryLimit") {
			t.Errorf("%s calls SetMemoryLimit: a fixed limit below a large cluster's live heap keeps the GC running back to back", f)
		}
	}
}
