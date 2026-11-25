package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"runtime/pprof"

	"github.com/go-chi/chi/v5"
)

// pprofProfiles are the snapshot profiles served: each is written at once,
// so none of them can hold a request open.
var pprofProfiles = map[string]bool{"heap": true, "allocs": true, "goroutine": true}

// writeProfile writes p in its compressed binary form; a test swaps it.
var writeProfile = func(p *pprof.Profile, w io.Writer) error { return p.WriteTo(w, 0) }

func pprofHandler(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	p := pprof.Lookup(name)
	if !pprofProfiles[name] || p == nil {
		http.Error(w, "unknown profile: use heap, allocs or goroutine", http.StatusNotFound)
		return
	}
	// The profile is gathered before any header goes out, so a failure is
	// a plain 500 rather than a 200 download of a cut-off file. It is
	// compressed and small: tens of KB, a few MB for a very large heap.
	var buf bytes.Buffer
	if err := writeProfile(p, &buf); err != nil {
		http.Error(w, "Could not write the "+name+" profile. Wait a moment and try again.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.pb.gz"`)
	_, _ = w.Write(buf.Bytes()) // a client gone mid-download has no one to tell
}
