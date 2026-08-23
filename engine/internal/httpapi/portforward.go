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
	fw       PortForward
	stop     chan struct{}
	stopOnce sync.Once
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
	cfg, err := p.Clusters.RestConfig(cluster)
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

	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: rt}, "POST", req.URL())
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
	}, stop: stop}
	p.m[id] = entry
	p.mu.Unlock()

	go func() { _ = fw.ForwardPorts() }()

	select {
	case <-ready:
	case <-time.After(15 * time.Second):
		p.Stop(id)
		msg := stderr.String()
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("tunnel not ready: %s", msg)
	case <-ctx.Done():
		p.Stop(id)
		return nil, ctx.Err()
	}

	ports, err := fw.GetPorts()
	if err != nil || len(ports) == 0 {
		p.Stop(id)
		return nil, fmt.Errorf("no forwarded ports: %v", err)
	}
	entry.fw.LocalPort = ports[0].Local
	out := entry.fw
	return &out, nil
}

func (p *PFManager) Stop(id string) bool {
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

func (p *PFManager) List() []PortForward {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]PortForward, 0, len(p.m))
	for _, e := range p.m {
		out = append(out, e.fw)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
