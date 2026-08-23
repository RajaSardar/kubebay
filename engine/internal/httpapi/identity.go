package httpapi

import (
	"context"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

func restConfigFor(ctx context.Context, m *clusters.Manager, cluster string) (*rest.Config, error) {
	return m.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(ctx))
}
