package main

import "runtime/debug"

// defaultMemoryLimit is the soft heap target the engine gives the Go GC when
// the operator set no GOMEMLIMIT: past it the GC works harder instead of
// letting the informer caches' garbage pile up. It is not a hard cap.
const defaultMemoryLimit = 512 << 20

// memoryLimitBytes is the limit to apply, and false when goenv (the
// GOMEMLIMIT value) is set: the runtime already honoured it.
func memoryLimitBytes(goenv string) (int64, bool) {
	if goenv != "" {
		return 0, false
	}
	return defaultMemoryLimit, true
}

func applyMemoryLimit(goenv string) {
	if n, ok := memoryLimitBytes(goenv); ok {
		debug.SetMemoryLimit(n)
	}
}
