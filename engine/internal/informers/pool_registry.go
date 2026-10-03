package informers

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
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

// Close tears down every pool built for clusterID, including impersonated
// ones ("id|user|groups"). The next For/ForUser builds a fresh pool.
func (r *PoolRegistry) Close(clusterID string) { r.closeWith(clusterID, stream.ReasonDisconnected) }

// Retire is Close after the cluster's credentials changed: subscribers are
// told to resubscribe, and get a pool built from the new config.
func (r *PoolRegistry) Retire(clusterID string) {
	r.closeWith(clusterID, stream.ReasonCredentialsChanged)
}

func (r *PoolRegistry) closeWith(clusterID, reason string) {
	r.mu.Lock()
	var closing []*Pool
	for key, p := range r.pools {
		if key == clusterID || strings.HasPrefix(key, clusterID+"\u007c") {
			closing = append(closing, p)
			delete(r.pools, key)
		}
	}
	r.mu.Unlock()
	for _, p := range closing {
		p.CloseWithReason(reason)
	}
}
