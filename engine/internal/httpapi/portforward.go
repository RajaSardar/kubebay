package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
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

// ErrPortInUse means the requested local port is already held, by another
// forward of this engine or by another process on the machine.
var ErrPortInUse = errors.New("local port in use")

// ErrInvalidPort means a port number is outside 1-65535 (0 = automatic local).
var ErrInvalidPort = errors.New("invalid port")

const (
	pfStarting = "starting"
	pfRunning  = "running"
	pfFailed   = "failed"
)

type PortForward struct {
	ID        string `json:"id"`
	Cluster   string `json:"cluster"`
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	PodPort   int32  `json:"podPort"`
	LocalPort uint16 `json:"localPort"`
	StartedAt string `json:"startedAt"`
	// Status is "running", or "failed" once the tunnel died (pod deleted or
	// restarted, connection lost); Error then says why.
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type pfEntry struct {
	fw PortForward
	// owner is the OIDC user who started the forward; "" without OIDC
	// (desktop), where every caller is the one local user.
	owner    string
	stop     chan struct{}
	stopOnce sync.Once
	// stopped is set (under PFManager.mu) when we closed the tunnel
	// ourselves, so its return is not reported as a failure.
	stopped bool
}

// live reports whether the entry still holds its local port.
func (e *pfEntry) live() bool { return e.fw.Status != pfFailed }

func ownerOf(ctx context.Context) string {
	if ident := clusters.IdentityFromContext(ctx); ident != nil {
		return ident.Name
	}
	return ""
}

// tunnel is the slice of client-go's forwarder the manager uses.
type tunnel interface {
	ForwardPorts() error
	GetPorts() ([]portforward.ForwardedPort, error)
}

type tunnelDialer func(ctx context.Context, cluster, namespace, pod string, podPort, localPort int32, stop <-chan struct{}, ready chan struct{}, stderr io.Writer) (tunnel, error)

// PFManager is the single registry of every port-forward in the engine,
// across all clusters, so one local port can never be handed out twice.
type PFManager struct {
	Clusters *clusters.Manager
	mu       sync.Mutex
	m        map[string]*pfEntry
	dial     tunnelDialer
	seq      uint64
}

func NewPFManager(c *clusters.Manager) *PFManager {
	p := &PFManager{Clusters: c, m: map[string]*pfEntry{}}
	p.dial = p.dialCluster
	return p
}

func (p *PFManager) dialCluster(ctx context.Context, cluster, namespace, pod string, podPort, localPort int32, stop <-chan struct{}, ready chan struct{}, stderr io.Writer) (tunnel, error) {
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
	fw, err := portforward.New(dialer, []string{fmt.Sprintf("%d:%d", localPort, podPort)}, stop, ready, io.Discard, stderr)
	if err != nil {
		return nil, fmt.Errorf("forwarder: %w", err)
	}
	return fw, nil
}

// portConflict returns an error if a live forward already holds port. Caller
// holds p.mu. Another user's forward is not described.
func (p *PFManager) portConflict(ctx context.Context, port int32) error {
	me := ownerOf(ctx)
	for _, e := range p.m {
		if !e.live() || int32(e.fw.LocalPort) != port {
			continue
		}
		if e.owner != me {
			return fmt.Errorf("%w: port %d is held by another user's forward", ErrPortInUse, port)
		}
		return fmt.Errorf("%w: port %d is already forwarded to %s/%s:%d on cluster %s; stop that forward first or pick another local port",
			ErrPortInUse, port, e.fw.Namespace, e.fw.Pod, e.fw.PodPort, e.fw.Cluster)
	}
	return nil
}

func (p *PFManager) Start(ctx context.Context, cluster, namespace, pod string, podPort, localPort int32) (*PortForward, error) {
	if podPort < 1 || podPort > 65535 {
		return nil, fmt.Errorf("%w: pod port %d must be 1-65535", ErrInvalidPort, podPort)
	}
	if localPort < 0 || localPort > 65535 {
		return nil, fmt.Errorf("%w: local port %d must be 1-65535 (or 0 for automatic)", ErrInvalidPort, localPort)
	}

	stop := make(chan struct{})
	ready := make(chan struct{})
	var stderr syncBuffer

	// Claim the port in the registry and probe the OS in one critical
	// section, so concurrent starts cannot both pass the check.
	p.mu.Lock()
	if localPort != 0 {
		if err := p.portConflict(ctx, localPort); err != nil {
			p.mu.Unlock()
			return nil, err
		}
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
		if err != nil {
			p.mu.Unlock()
			return nil, fmt.Errorf("%w: port %d is already bound by another process on this machine", ErrPortInUse, localPort)
		}
		_ = l.Close()
	}
	p.seq++
	id := fmt.Sprintf("pf-%d-%d", time.Now().UnixNano(), p.seq)
	entry := &pfEntry{fw: PortForward{
		ID: id, Cluster: cluster, Namespace: namespace, Pod: pod,
		PodPort: podPort, LocalPort: uint16(localPort), Status: pfStarting,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}, owner: ownerOf(ctx), stop: stop}
	p.m[id] = entry
	p.mu.Unlock()

	drop := func() {
		p.mu.Lock()
		delete(p.m, id)
		entry.stopped = true
		p.mu.Unlock()
		entry.stopOnce.Do(func() { close(stop) })
	}

	t, err := p.dial(ctx, cluster, namespace, pod, podPort, localPort, stop, ready, &stderr)
	if err != nil {
		drop()
		return nil, err
	}

	runErr := make(chan error, 1)
	go func() {
		err := t.ForwardPorts()
		if err == nil {
			err = errors.New("tunnel closed")
		}
		p.mu.Lock()
		// A tunnel that ends after it was ready, without us stopping it,
		// has died (pod deleted/restarted, connection lost): keep the row
		// but mark it failed, which also frees its local port.
		if !entry.stopped && p.m[id] == entry && entry.fw.Status == pfRunning {
			entry.fw.Status = pfFailed
			entry.fw.Error = err.Error()
		}
		p.mu.Unlock()
		runErr <- err
	}()

	select {
	case <-ready:
	case err := <-runErr:
		drop()
		if msg := strings.TrimSpace(stderr.String()); msg != "" && !strings.Contains(err.Error(), msg) {
			err = fmt.Errorf("%w: %s", err, truncate(msg, 300))
		}
		return nil, fmt.Errorf("port-forward failed: %w", err)
	case <-time.After(15 * time.Second):
		drop()
		return nil, fmt.Errorf("tunnel not ready: %s", truncate(stderr.String(), 300))
	case <-ctx.Done():
		drop()
		return nil, ctx.Err()
	}

	ports, err := t.GetPorts()
	if err != nil || len(ports) == 0 {
		drop()
		return nil, fmt.Errorf("no forwarded ports: %v", err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.m[id] != entry {
		return nil, errors.New("port-forward was stopped while starting")
	}
	entry.fw.LocalPort = ports[0].Local
	if entry.fw.Status == pfStarting {
		entry.fw.Status = pfRunning
	}
	out := entry.fw
	return &out, nil
}

// pfErrorStatus maps a Start error to its HTTP status.
func pfErrorStatus(err error) int {
	switch {
	case errors.Is(err, ErrPortInUse):
		return http.StatusConflict
	case errors.Is(err, ErrInvalidPort):
		return http.StatusBadRequest
	}
	return http.StatusBadGateway
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// syncBuffer is a bytes.Buffer safe for the forwarder's goroutines to write
// while Start reads it.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// Stop ends a forward the caller started (or dismisses a failed one).
// Another user's forward reads as unknown, so its existence isn't revealed
// either.
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
		entry.stopped = true
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

// StopAll stops every port-forward (engine shutdown).
func (p *PFManager) StopAll() {
	p.mu.Lock()
	ids := make([]string, 0, len(p.m))
	for id := range p.m {
		ids = append(ids, id)
	}
	p.mu.Unlock()
	for _, id := range ids {
		p.stop(id)
	}
}

// Count is the number of live port-forwards, every owner's; dead (failed)
// ones awaiting dismissal are not counted.
func (p *PFManager) Count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, e := range p.m {
		if e.live() {
			n++
		}
	}
	return n
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
