package informers

import (
	"context"
	"fmt"
	"slices"
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

// For returns the pool for the identity on ctx (set by the OIDC middleware
// on the request the stream came from), or the engine's own pool without one.
func (r *PoolRegistry) For(ctx context.Context, clusterID string) (*Pool, error) {
	return r.ForUser(ctx, clusterID, clusters.IdentityFromContext(ctx))
}

// registryKey is "id" for the engine's own identity, else "id|user|groups":
// groups are part of the impersonation, so a membership change gets a new pool.
func registryKey(clusterID string, ident *clusters.Identity) string {
	if ident == nil || ident.Name == "" {
		return clusterID
	}
	groups := slices.Clone(ident.Groups)
	slices.Sort(groups)
	return clusterID + "\u007c" + ident.Name + "\u007c" + strings.Join(groups, ",")
}

func (r *PoolRegistry) ForUser(_ context.Context, clusterID string, ident *clusters.Identity) (*Pool, error) {
	key := registryKey(clusterID, ident)
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
