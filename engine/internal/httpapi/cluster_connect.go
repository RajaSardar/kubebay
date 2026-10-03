package httpapi

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

// TeardownOnDisconnect stops a cluster's informers (ending its open streams)
// and its port-forwards whenever it is disconnected or leaves the kubeconfig
// while connected.
func TeardownOnDisconnect(mgr *clusters.Manager, pools *informers.PoolRegistry, pf *PFManager) {
	mgr.OnDisconnect(pools.Close)
	// New credentials in the kubeconfig: rebuild the informers with them, and
	// tell open streams to resubscribe rather than reporting a disconnect.
	mgr.OnConfigChange(pools.Retire)
	if pf != nil {
		mgr.OnDisconnect(pf.StopCluster)
	}
}

// connectClusterHandler marks a cluster connected and returns it. Opening a
// stream also connects, so this is for connecting without navigating.
func connectClusterHandler(mgr *clusters.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if err := mgr.Connect(id); err != nil {
			code := http.StatusConflict
			if strings.HasPrefix(err.Error(), "unknown cluster") {
				code = http.StatusNotFound
			}
			http.Error(w, err.Error(), code)
			return
		}
		for _, c := range mgr.List() {
			if c.ID == id {
				writeJSON(w, c)
				return
			}
		}
		http.Error(w, "cluster "+id+" disappeared", http.StatusNotFound)
	}
}

// disconnectClusterHandler tears down what a cluster has open: its informers
// (every open stream ends with a "cluster disconnected" error frame) and its
// port-forwards. With OIDC on, pools are shared between logged-in users, so
// one user's Disconnect would cut everyone's streams: it is desktop-only.
func disconnectClusterHandler(mgr *clusters.Manager, authOn bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if authOn {
			http.Error(w, "disconnect is not available when OIDC is configured: streams are shared between users", http.StatusForbidden)
			return
		}
		if err := mgr.Disconnect(chi.URLParam(r, "id")); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	}
}
