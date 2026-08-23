package informers

import (
	"context"
	"fmt"
	"sync"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

type ClusterConfigSource interface {
	RestConfig(id string) (*rest.Config, error)
	RestConfigWithIdentity(id string, ident *clusters.Identity) (*rest.Config, error)
}

type PoolRegistry struct {
	mgr   ClusterConfigSource
	mu    sync.Mutex
	pools map[string]*Pool
}

func NewPoolRegistry(mgr ClusterConfigSource) *PoolRegistry {
	return &PoolRegistry{mgr: mgr, pools: map[string]*Pool{}}
}

func (r *PoolRegistry) For(_ context.Context, clusterID string) (*Pool, error) {
	ident := clusters.IdentityFromContext(context.Background())
	return r.ForUser(context.Background(), clusterID, ident)
}

func (r *PoolRegistry) ForUser(ctx context.Context, clusterID string, ident *clusters.Identity) (*Pool, error) {
	key := clusterID
	if ident != nil && ident.Name != "" {
		key = clusterID + "\u007c" + ident.Name
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := r.pools[key]; ok {
		return p, nil
	}
	cfg, err := r.mgr.RestConfigWithIdentity(clusterID, ident)
	if err != nil {
		return nil, fmt.Errorf("resolve cluster %q: %w", clusterID, err)
	}
	p, err := New(cfg)
	if err != nil {
		return nil, fmt.Errorf("init pool for %q: %w", clusterID, err)
	}
	r.pools[key] = p
	return p, nil
}
