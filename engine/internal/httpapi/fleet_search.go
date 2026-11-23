package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/fleet"
)

// coldSearchHandler answers POST /api/search/clusters {ids, q}: the
// cross-cluster search of clusters that are not connected, by name or kind
// and name. The user opts in; the web sends only the clusters it holds no
// streams for. It never blocks on a cluster (pending ones come back pending,
// the client asks again), lists as the signed-in identity, and never
// connects a cluster, so it doesn't count against the warm cap.
func coldSearchHandler(mgr *clusters.Manager, s *fleet.Searcher) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			IDs []string `json:"ids"`
			Q   string   `json:"q"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
			http.Error(w, `body must be {"ids": [...], "q": "..."}`, http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(body.Q) == "" {
			http.Error(w, "q required", http.StatusBadRequest)
			return
		}
		if utf8.RuneCountInString(body.Q) > maxSearchQuery {
			http.Error(w, "q too long", http.StatusBadRequest)
			return
		}
		ident := clusters.IdentityFromContext(r.Context())
		scope := ""
		if ident != nil {
			scope = ident.Name
		}
		cfg := func(id string) (*rest.Config, error) { return mgr.RestConfigWithIdentity(id, ident) }
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, s.Search(scope, body.IDs, body.Q, cfg))
	}
}
