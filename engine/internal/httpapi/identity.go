package httpapi

import (
	"net/http"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

func restConfigFor(r *http.Request, m *clusters.Manager, cluster string) (*rest.Config, error) {
	return m.RestConfigWithIdentity(cluster, IdentityFromContext(r.Context()))
}
