package informers

import (
	"context"
	"fmt"
	"sync"

	"k8s.io/client-go/rest"
)

type ClusterConfigSource interface {
	RestConfig(id string) (*rest.Config, error)
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
	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := r.pools[clusterID]; ok {
		return p, nil
	}
	cfg, err := r.mgr.RestConfig(clusterID)
	if err != nil {
		return nil, fmt.Errorf("resolve cluster %q: %w", clusterID, err)
	}
	p, err := New(cfg)
	if err != nil {
		return nil, fmt.Errorf("init pool for %q: %w", clusterID, err)
	}
	r.pools[clusterID] = p
	return p, nil
}
