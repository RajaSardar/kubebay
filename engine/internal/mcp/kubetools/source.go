package kubetools

import (
	"context"
	"fmt"
	"io"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
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

// Get reads one object live. A single GET is cheap, and the informer cache
// for an arbitrary kind may not exist yet.
func (s PoolSource) Get(ctx context.Context, cluster, gvr, ns, name string) (map[string]any, error) {
	cfg, err := s.Manager.RestConfig(cluster)
	if err != nil {
		return nil, err
	}
	g, err := informers.ParseGVR(gvr)
	if err != nil {
		return nil, err
	}
	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	ri := dyn.Resource(g)
	if ns != "" {
		u, err := ri.Namespace(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		return u.Object, nil
	}
	u, err := ri.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return u.Object, nil
}

// Patch applies a strategic merge patch as field manager "kubebay-mcp", so
// changes an assistant proposed and a person approved are attributable in
// managedFields. A dry run changes nothing.
func (s PoolSource) Patch(ctx context.Context, cluster, gvr, ns, name string, patch []byte, dryRun bool) (map[string]any, error) {
	cfg, err := s.Manager.RestConfig(cluster)
	if err != nil {
		return nil, err
	}
	g, err := informers.ParseGVR(gvr)
	if err != nil {
		return nil, err
	}
	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	opts := metav1.PatchOptions{FieldManager: "kubebay-mcp"}
	if dryRun {
		opts.DryRun = []string{metav1.DryRunAll}
	}
	u, err := dyn.Resource(g).Namespace(ns).Patch(ctx, name, types.StrategicMergePatchType, patch, opts)
	if err != nil {
		return nil, err
	}
	return u.Object, nil
}

// Logs reads a bounded tail of one container's log; the API server enforces
// LimitBytes, and the read is capped again here.
func (s PoolSource) Logs(ctx context.Context, cluster, ns, pod string, opt LogOptions) (string, error) {
	cfg, err := s.Manager.RestConfig(cluster)
	if err != nil {
		return "", err
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	tail := int64(opt.TailLines)
	limit := int64(opt.LimitBytes)
	rc, err := cs.CoreV1().Pods(ns).GetLogs(pod, &corev1.PodLogOptions{
		Container:  opt.Container,
		Previous:   opt.Previous,
		TailLines:  &tail,
		LimitBytes: &limit,
	}).Stream(ctx)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, limit))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

var (
	_ Inspector         = PoolSource{}
	_ proposals.Patcher = PoolSource{}
)
