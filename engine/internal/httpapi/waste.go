package httpapi

import (
	"net/http"

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
func wasteWorkloadsHandler(s wasteSnapshotter) http.HandlerFunc {
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
		writeJSON(w, s.Snapshot(cluster))
	}
}
