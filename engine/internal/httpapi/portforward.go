package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

type PortForward struct {
	ID        string `json:"id"`
	Cluster   string `json:"cluster"`
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	PodPort   int32  `json:"podPort"`
	LocalPort uint16 `json:"localPort"`
	StartedAt string `json:"startedAt"`
}

type pfEntry struct {
	fw PortForward
	// owner is the OIDC user who started the forward; "" without OIDC
	// (desktop), where every caller is the one local user.
	owner    string
	stop     chan struct{}
	stopOnce sync.Once
}

func ownerOf(ctx context.Context) string {
	if ident := clusters.IdentityFromContext(ctx); ident != nil {
		return ident.Name
	}
	return ""
}

type PFManager struct {
	Clusters *clusters.Manager
	mu       sync.Mutex
	m        map[string]*pfEntry
}

func NewPFManager(c *clusters.Manager) *PFManager {
	return &PFManager{Clusters: c, m: map[string]*pfEntry{}}
}

func (p *PFManager) Start(ctx context.Context, cluster, namespace, pod string, podPort, localPort int32) (*PortForward, error) {
	cfg, err := restConfigFor(ctx, p.Clusters, cluster)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("client: %w", err)
	}
	rt, upgrader, err := spdy.RoundTripperFor(cfg)
	if err != nil {
		return nil, fmt.Errorf("transport: %w", err)
	}
	req := cs.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Namespace(namespace).
		Name(pod).
		SubResource("portforward").
		VersionedParams(&corev1.PodPortForwardOptions{Ports: []int32{podPort}}, scheme.ParameterCodec)

	// WebSocket-first with automatic SPDY fallback, matching exec.go: SPDY's
	// HTTP/1.1 upgrade does not survive HTTP/2 reverse proxies (AWS ALB,
	// corporate proxies), so a SPDY-only port-forward dies exactly where exec
	// keeps working.  The tunneling dialer issues its own GET; the same URL
	// serves both paths.  Predicate is kubectl's.
	spdyDialer := spdy.NewDialer(upgrader, &http.Client{Transport: rt}, "POST", req.URL())
	wsDialer, err := portforward.NewSPDYOverWebsocketDialer(req.URL(), cfg)
	if err != nil {
		return nil, fmt.Errorf("websocket dialer: %w", err)
	}
	dialer := portforward.NewFallbackDialer(wsDialer, spdyDialer, func(err error) bool {
		return httpstream.IsUpgradeFailure(err) || httpstream.IsHTTPSProxyError(err)
	})

	stop := make(chan struct{})
	ready := make(chan struct{})
	var stderr bytes.Buffer

	fw, err := portforward.New(dialer, []string{fmt.Sprintf("%d:%d", localPort, podPort)}, stop, ready, io.Discard, &stderr)
	if err != nil {
		return nil, fmt.Errorf("forwarder: %w", err)
	}

	p.mu.Lock()
	id := fmt.Sprintf("pf-%d", time.Now().UnixNano())
	entry := &pfEntry{fw: PortForward{
		ID: id, Cluster: cluster, Namespace: namespace, Pod: pod,
		PodPort: podPort, StartedAt: time.Now().UTC().Format(time.RFC3339),
	}, owner: ownerOf(ctx), stop: stop}
	p.m[id] = entry
	p.mu.Unlock()

	go func() { _ = fw.ForwardPorts() }()

	select {
	case <-ready:
	case <-time.After(15 * time.Second):
		p.stop(id)
		msg := stderr.String()
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("tunnel not ready: %s", msg)
	case <-ctx.Done():
		p.stop(id)
		return nil, ctx.Err()
	}

	ports, err := fw.GetPorts()
	if err != nil || len(ports) == 0 {
		p.stop(id)
		return nil, fmt.Errorf("no forwarded ports: %v", err)
	}
	entry.fw.LocalPort = ports[0].Local
	out := entry.fw
	return &out, nil
}

// Stop ends a forward the caller started. Another user's forward reads as
// unknown, so its existence isn't revealed either.
func (p *PFManager) Stop(ctx context.Context, id string) bool {
	p.mu.Lock()
	entry, ok := p.m[id]
	if ok && entry.owner != ownerOf(ctx) {
		ok = false
	}
	p.mu.Unlock()
	if !ok {
		return false
	}
	return p.stop(id)
}

func (p *PFManager) stop(id string) bool {
	p.mu.Lock()
	entry, ok := p.m[id]
	if ok {
		delete(p.m, id)
	}
	p.mu.Unlock()
	if !ok {
		return false
	}
	entry.stopOnce.Do(func() { close(entry.stop) })
	return true
}

// StopCluster stops every port-forward into a cluster, whoever started it
// (on disconnect, when the cluster's clients are torn down).
func (p *PFManager) StopCluster(cluster string) {
	p.mu.Lock()
	var ids []string
	for id, e := range p.m {
		if e.fw.Cluster == cluster {
			ids = append(ids, id)
		}
	}
	p.mu.Unlock()
	for _, id := range ids {
		p.stop(id)
	}
}

// List returns the caller's own forwards.
func (p *PFManager) List(ctx context.Context) []PortForward {
	owner := ownerOf(ctx)
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]PortForward, 0, len(p.m))
	for _, e := range p.m {
		if e.owner == owner {
			out = append(out, e.fw)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
