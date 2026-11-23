package httpapi

import (
	"net/http"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/waste"
)

// wasteSnapshotter is the seam *waste.Sampler satisfies structurally — kept
// as its own interface so the handler is testable without a live sampler.
type wasteSnapshotter interface {
	Snapshot(cluster string) []waste.WorkloadWaste
}

// wasteWorkloadsHandler serves GET /api/waste/workloads?cluster=<id> — the
// shared usage recommender's current snapshot (metrics-server Tier B only;
// see internal/waste's doc comment). Rendered as a per-workload banner in
// the right-sizing flow and as a sorted table in the Cost/Waste view.
//
// The sampler collects under the engine's own identity, so with a signed-in
// OIDC user the rows are cut to the namespaces that user may list pods in.
// A failed or missing access check shows nothing (fail closed).
func wasteWorkloadsHandler(s wasteSnapshotter, can podListAccess) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cluster := r.URL.Query().Get("cluster")
		if cluster == "" {
			http.Error(w, "cluster required", http.StatusBadRequest)
			return
		}
		if s == nil {
			writeJSON(w, []waste.WorkloadWaste{})
			return
		}
		rows := s.Snapshot(cluster)
		if id := clusters.IdentityFromContext(r.Context()); id != nil && id.Name != "" {
			rows = filterWasteByPodAccess(r, cluster, rows, can)
		}
		writeJSON(w, rows)
	}
}

func filterWasteByPodAccess(r *http.Request, cluster string, rows []waste.WorkloadWaste, can podListAccess) []waste.WorkloadWaste {
	out := []waste.WorkloadWaste{}
	if can == nil || len(rows) == 0 {
		return out
	}
	if all, err := can(r.Context(), cluster, ""); err == nil && all {
		return rows
	}
	allowed := map[string]bool{}
	for _, row := range rows {
		ok, seen := allowed[row.Ns]
		if !seen {
			v, err := can(r.Context(), cluster, row.Ns)
			ok = err == nil && v
			allowed[row.Ns] = ok
		}
		if ok {
			out = append(out, row)
		}
	}
	return out
}
