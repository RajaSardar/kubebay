package main

import (
	"math"
	"runtime/debug"
	"testing"
)

// A fixed default limit below the live heap keeps the GC running back to
// back: a 560 MiB live heap under a 512 MiB limit burned 5.8 cores on GC
// alone, and 0 to 0.3 cores with no limit. So the engine sets none.
func TestApplyMemoryLimitSetsNoDefault(t *testing.T) {
	prev := debug.SetMemoryLimit(-1)
	t.Cleanup(func() { debug.SetMemoryLimit(prev) })
	debug.SetMemoryLimit(math.MaxInt64)

	applyMemoryLimit("")
	if got := debug.SetMemoryLimit(-1); got != math.MaxInt64 {
		t.Fatalf("memory limit = %d, want none (MaxInt64)", got)
	}
}

func TestApplyMemoryLimitLeavesOperatorValue(t *testing.T) {
	prev := debug.SetMemoryLimit(-1)
	t.Cleanup(func() { debug.SetMemoryLimit(prev) })
	debug.SetMemoryLimit(2 << 30) // what the runtime set from GOMEMLIMIT=2GiB

	applyMemoryLimit("2GiB")
	if got := debug.SetMemoryLimit(-1); got != 2<<30 {
		t.Fatalf("memory limit = %d, want the operator's 2 GiB", got)
	}
}
