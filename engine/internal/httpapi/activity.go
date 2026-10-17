package httpapi

import (
	"net/http"
	"sync/atomic"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// Activity is what restarting the engine would interrupt. The desktop app
// reads it before it installs an update, and won't restart while any of it is
// non-zero (KB-04).
type Activity struct {
	// Terminals are open exec and local-shell sessions.
	Terminals int `json:"terminals"`
	// PortForwards are running port-forwards, whether or not a page still shows them.
	PortForwards int `json:"portForwards"`
	// Writes are API requests that may change something (any method but GET,
	// HEAD and OPTIONS) still being handled: an apply, a delete, a Helm upgrade.
	Writes int `json:"writes"`
}

// writeTracker counts the writes in flight through the handlers it wraps.
type writeTracker struct{ n atomic.Int64 }

func (t *writeTracker) inFlight() int { return int(t.n.Load()) }

func (t *writeTracker) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			t.n.Add(1)
			defer t.n.Add(-1)
		}
		next.ServeHTTP(w, r)
	})
}

func activityHandler(hub *stream.Hub, pf *PFManager, writes *writeTracker) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		var a Activity
		if hub != nil {
			a.Terminals = hub.Terminals()
		}
		if pf != nil {
			a.PortForwards = pf.Count()
		}
		a.Writes = writes.inFlight()
		writeJSON(w, a)
	}
}
