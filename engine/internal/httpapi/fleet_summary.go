package httpapi

import (
	"encoding/json"
	"net/http"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/fleet"
)

// fleetSummaryHandler answers POST /api/clusters/summary {ids}: the cheap
// fleet-tier summary (reachability, version, nodes ready) for the clusters
// the picker shows. It never blocks on a cluster: missing or stale summaries
// come back pending and the client asks again. It does not connect clusters,
// so it starts no informers and never counts against the warm cap.
func fleetSummaryHandler(mgr *clusters.Manager, sum *fleet.Summarizer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
			http.Error(w, `body must be {"ids": [...]}`, http.StatusBadRequest)
			return
		}
		ident := clusters.IdentityFromContext(r.Context())
		scope := ""
		if ident != nil {
			scope = ident.Name
		}
		cfg := func(id string) (*rest.Config, error) { return mgr.RestConfigWithIdentity(id, ident) }
		writeJSON(w, map[string]any{"summaries": sum.Get(scope, body.IDs, cfg)})
	}
}
