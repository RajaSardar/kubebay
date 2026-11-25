package httpapi

import (
	"net/http"
	"runtime/pprof"

	"github.com/go-chi/chi/v5"
)

// pprofProfiles are the snapshot profiles served: each is written at once,
// so none of them can hold a request open.
var pprofProfiles = map[string]bool{"heap": true, "allocs": true, "goroutine": true}

func pprofHandler(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	p := pprof.Lookup(name)
	if !pprofProfiles[name] || p == nil {
		http.Error(w, "unknown profile: use heap, allocs or goroutine", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.pb.gz"`)
	_ = p.WriteTo(w, 0)
}
