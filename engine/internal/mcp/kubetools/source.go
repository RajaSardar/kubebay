package kubetools

import (
	"context"
	"fmt"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

// PoolSource reads from the engine's shared informer pools, so a tool call
// is served from the warm cache the UI already keeps (and warms it if not)
// rather than a fresh LIST against the API server on every question.
type PoolSource struct {
	Pools   *informers.PoolRegistry
	Manager *clusters.Manager
	// Timeout bounds waiting for an informer's first sync.
	Timeout time.Duration
}

func (s PoolSource) Clusters() []clusters.Cluster { return s.Manager.List() }

// Snapshot subscribes, takes the first snapshot of each namespace's informer,
// and unsubscribes.
func (s PoolSource) Snapshot(ctx context.Context, cluster, gvr string, namespaces []string, selector, mode string) ([]map[string]any, error) {
	timeout := s.Timeout
	if timeout == 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	pool, err := s.Pools.For(ctx, cluster)
	if err != nil {
		return nil, err
	}
	sub, err := pool.Subscribe(ctx, gvr, namespaces, selector, mode)
	if err != nil {
		return nil, err
	}
	want := len(namespaces)
	if want == 0 {
		want = 1
	}
	var out []map[string]any
	for i := 0; i < want; i++ {
		select {
		case ops := <-sub.Snapshot():
			for _, op := range ops {
				if op.Obj != nil {
					out = append(out, op.Obj)
				}
			}
		case <-ctx.Done():
			return nil, fmt.Errorf("timed out waiting for %s in %s to sync", gvr, cluster)
		}
	}
	return out, nil
}
