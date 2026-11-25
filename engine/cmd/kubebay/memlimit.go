package main

// applyMemoryLimit leaves the Go GC at its default (GOGC=100, no soft limit)
// unless the operator set GOMEMLIMIT, which the runtime has already applied.
//
// The engine used to set a fixed 512 MiB soft limit. Once a large cluster's
// informer caches pushed the live heap past it, the GC ran back to back: in
// a synthetic test a 560 MiB live heap under a 512 MiB limit spent 5.8 cores
// on GC, against 0.0 to 0.3 cores with no limit. A limit below the working
// set costs CPU and frees nothing, so there is no default.
func applyMemoryLimit(goenv string) {
	_ = goenv
}
