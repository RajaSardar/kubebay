package waste

import (
	"context"
	"log/slog"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

const (
	defaultInterval = 60 * time.Second
	defaultCapacity = 180 // 3h at a 60s tick
)

type reqTotals struct {
	CPUMillis int64
	MemBytes  int64
}

type podUsage struct {
	CPUMillis int64
	MemBytes  int64
}

// Sampler is the Tier B (metrics-server) usage recommender: a background
// poller that aggregates pod-level usage up to the owning
// Deployment/StatefulSet/DaemonSet and keeps a rolling window per workload.
// It never touches Prometheus — that's Tier A, a separate, gated tier.
type Sampler struct {
	mgr      *clusters.Manager
	log      *slog.Logger
	interval time.Duration
	capacity int

	mu        sync.Mutex
	buffers   map[WorkloadKey]*ringBuffer
	requested map[WorkloadKey]reqTotals
}

func NewSampler(mgr *clusters.Manager, log *slog.Logger) *Sampler {
	return &Sampler{
		mgr:       mgr,
		log:       log,
		interval:  defaultInterval,
		capacity:  defaultCapacity,
		buffers:   make(map[WorkloadKey]*ringBuffer),
		requested: make(map[WorkloadKey]reqTotals),
	}
}

// Start runs the sampler loop until ctx is cancelled. It samples immediately
// on start (rather than waiting a full interval) so the first UI load after
// engine startup isn't gratuitously empty.
func (s *Sampler) Start(ctx context.Context) {
	go func() {
		s.tick(ctx)
		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.tick(ctx)
			}
		}
	}()
}

func (s *Sampler) tick(ctx context.Context) {
	for _, c := range s.mgr.List() {
		if c.Status != clusters.StatusConnected {
			continue
		}
		cfg, err := s.mgr.RestConfig(c.ID)
		if err != nil {
			continue // e.g. a misconfigured entry mid-list — skip, don't fail the whole tick
		}
		cs, err := kubernetes.NewForConfig(cfg)
		if err != nil {
			s.log.Warn("waste sampler: client init failed", "cluster", c.ID, "err", err)
			continue
		}
		mc, err := metricsv.NewForConfig(cfg)
		if err != nil {
			s.log.Warn("waste sampler: metrics client init failed", "cluster", c.ID, "err", err)
			continue
		}
		if err := s.sampleCluster(ctx, c.ID, cs, mc); err != nil {
			s.log.Warn("waste sampler: sample failed", "cluster", c.ID, "err", err)
		}
	}
}

// sampleCluster takes its clients as parameters (rather than constructing
// them) so the aggregation logic is testable against fake clientsets
// without a live cluster.
func (s *Sampler) sampleCluster(ctx context.Context, clusterID string, cs kubernetes.Interface, mc metricsv.Interface) error {
	tctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	// A full-cluster Pod/ReplicaSet list every tick is real API-server load on
	// a very large cluster — an accepted tradeoff for v1's honesty-first,
	// no-history-store design; revisit with field selectors or an informer
	// if this shows up as a real cost.
	pods, err := cs.CoreV1().Pods(metav1.NamespaceAll).List(tctx, metav1.ListOptions{})
	if err != nil {
		return err
	}
	rss, err := cs.AppsV1().ReplicaSets(metav1.NamespaceAll).List(tctx, metav1.ListOptions{})
	if err != nil {
		return err
	}

	metricsByPod := map[string]podUsage{}
	if pmList, merr := mc.MetricsV1beta1().PodMetricses(metav1.NamespaceAll).List(tctx, metav1.ListOptions{}); merr == nil {
		for _, pm := range pmList.Items {
			var cpu, mem int64
			for _, c := range pm.Containers {
				cpu += c.Usage.Cpu().MilliValue()
				mem += c.Usage.Memory().Value()
			}
			metricsByPod[pm.Namespace+"/"+pm.Name] = podUsage{CPUMillis: cpu, MemBytes: mem}
		}
	}
	// A metrics-server list error (most commonly: not installed) is not fatal
	// to the tick — requests still update, usage samples just don't this round.

	rsOwners := map[string]ownerRef{}
	for _, rs := range rss.Items {
		if ref := controllerOwner(rs.OwnerReferences); ref != nil {
			rsOwners[string(rs.UID)] = *ref
		}
	}

	now := time.Now()
	tickRequested := map[WorkloadKey]reqTotals{}
	tickUsage := map[WorkloadKey]podUsage{}
	tickHasUsage := map[WorkloadKey]bool{}

	for _, pod := range pods.Items {
		owner := controllerOwner(pod.OwnerReferences)
		kind, name, ok := resolveWorkload(podRef{Owner: owner}, rsOwners)
		if !ok {
			continue
		}
		key := WorkloadKey{Cluster: clusterID, Ns: pod.Namespace, Kind: kind, Name: name}

		var reqCPU, reqMem int64
		for _, c := range pod.Spec.Containers {
			reqCPU += c.Resources.Requests.Cpu().MilliValue()
			reqMem += c.Resources.Requests.Memory().Value()
		}
		rt := tickRequested[key]
		rt.CPUMillis += reqCPU
		rt.MemBytes += reqMem
		tickRequested[key] = rt

		if u, found := metricsByPod[pod.Namespace+"/"+pod.Name]; found {
			uu := tickUsage[key]
			uu.CPUMillis += u.CPUMillis
			uu.MemBytes += u.MemBytes
			tickUsage[key] = uu
			tickHasUsage[key] = true
		}
	}

	s.mu.Lock()
	for key, rt := range tickRequested {
		s.requested[key] = rt
		if !tickHasUsage[key] {
			continue
		}
		rb, ok := s.buffers[key]
		if !ok {
			rb = newRingBuffer(s.capacity)
			s.buffers[key] = rb
		}
		u := tickUsage[key]
		rb.add(Sample{Time: now, CPUMillis: u.CPUMillis, MemBytes: u.MemBytes})
	}
	s.mu.Unlock()

	return nil
}

func controllerOwner(refs []metav1.OwnerReference) *ownerRef {
	for _, r := range refs {
		if r.Controller != nil && *r.Controller {
			return &ownerRef{Kind: r.Kind, Name: r.Name, UID: string(r.UID)}
		}
	}
	return nil
}

// Snapshot returns the current recommendation rows for one cluster. A
// workload with requests but no usage samples yet (Tier C: "explain and
// stop") is omitted rather than shown with a fabricated zero.
func (s *Sampler) Snapshot(clusterID string) []WorkloadWaste {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	out := make([]WorkloadWaste, 0)
	for key, rt := range s.requested {
		if key.Cluster != clusterID {
			continue
		}
		rb, ok := s.buffers[key]
		if !ok || rb.count() == 0 {
			continue
		}
		cpu95, mem95 := rb.percentileCPUMem(0.95)
		out = append(out, WorkloadWaste{
			Cluster:            clusterID,
			Ns:                 key.Ns,
			Kind:               key.Kind,
			Name:               key.Name,
			RequestedCPUMillis: rt.CPUMillis,
			RequestedMemBytes:  rt.MemBytes,
			P95CPUMillis:       cpu95,
			P95MemBytes:        mem95,
			Source:             "metrics-server",
			Window:             rb.windowLabel(now),
		})
	}
	return out
}
