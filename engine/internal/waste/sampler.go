package waste

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

const (
	defaultInterval = 60 * time.Second
	defaultCapacity = 180 // 3h at a 60s tick

	// Tier A queries 7 days of history through Prometheus's own storage —
	// there is no in-memory window to keep, so it ticks far less often than
	// Tier B; a p95 over a week doesn't meaningfully change minute to minute.
	tierAInterval = 5 * time.Minute
	tierAWindow   = "7d"
	tierAStep     = 5 * time.Minute
)

type reqTotals struct {
	CPUMillis int64
	MemBytes  int64
	PodCount  int
}

type podUsage struct {
	CPUMillis int64
	MemBytes  int64
}

// PrometheusURLResolver resolves the Prometheus base URL configured for one
// cluster, or "" if none is configured — the same per-cluster resolution
// promquery.go's handlers use, injected here rather than imported directly
// so internal/waste never depends on internal/httpapi (which already
// depends on internal/waste, and a cycle isn't worth avoiding just to skip
// one function-typed field).
type PrometheusURLResolver func(cluster string) string

// NsUsage is one tick's totals for one namespace ("" is the cluster
// total), counted over every running pod, bare pods included.
type NsUsage struct {
	Ns           string
	CPUMillis    int64
	MemBytes     int64
	HasUsage     bool // false when metrics-server returned nothing this tick
	ReqCPUMillis int64
	ReqMemBytes  int64
}

// UsageRecorder receives a cluster's namespace totals after each Tier B
// tick. It's how the history store (backlog #36) is fed without the waste
// package depending on it, and without a second poller.
type UsageRecorder func(ctx context.Context, clusterID string, cs kubernetes.Interface, at time.Time, usage []NsUsage)

type tierAEntry struct {
	CPUP95Millis int64
	MemP95Bytes  int64
	Window       string
}

// Sampler is the usage-based right-sizing recommender: a background poller
// that aggregates pod-level usage up to the owning
// Deployment/StatefulSet/DaemonSet. Tier B (metrics-server) keeps a rolling
// in-memory window per workload; Tier A (Prometheus, when configured) is a
// slower-ticking overlay that wins whenever it's available and sufficiently
// probed — see Snapshot.
type Sampler struct {
	mgr      *clusters.Manager
	log      *slog.Logger
	interval time.Duration
	capacity int

	promResolver PrometheusURLResolver
	promInterval time.Duration
	httpClient   *http.Client

	recordFilter func(clusterID string) bool
	recorder     UsageRecorder
	// gate, when set, limits polling to clusters it accepts (connected by the
	// user or enrolled in usage history). Set before Start.
	gate func(clusterID string) bool

	mu        sync.Mutex
	buffers   map[WorkloadKey]*ringBuffer
	requested map[WorkloadKey]reqTotals
	tierA     map[WorkloadKey]tierAEntry
}

func NewSampler(mgr *clusters.Manager, log *slog.Logger) *Sampler {
	return &Sampler{
		mgr:          mgr,
		log:          log,
		interval:     defaultInterval,
		capacity:     defaultCapacity,
		promInterval: tierAInterval,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		buffers:      make(map[WorkloadKey]*ringBuffer),
		requested:    make(map[WorkloadKey]reqTotals),
		tierA:        make(map[WorkloadKey]tierAEntry),
	}
}

// SetPrometheusResolver wires up Tier A. Called once from main after the
// settings manager exists; a Sampler with no resolver set simply never runs
// Tier A, same as any cluster with no Prometheus configured.
func (s *Sampler) SetPrometheusResolver(r PrometheusURLResolver) {
	s.promResolver = r
}

// SetRecorder feeds rec each tick, but only for clusters filter accepts:
// history is recorded for clusters the user connected to, never for every
// context the health loop happens to reach. Call before Start.
func (s *Sampler) SetRecorder(filter func(clusterID string) bool, rec UsageRecorder) {
	s.recordFilter = filter
	s.recorder = rec
}

// SetGate limits which reachable clusters are polled. Call before Start.
func (s *Sampler) SetGate(gate func(clusterID string) bool) {
	s.gate = gate
}

func (s *Sampler) shouldSample(c clusters.Cluster) bool {
	if c.Status != clusters.StatusConnected {
		return false
	}
	return s.gate == nil || s.gate(c.ID)
}

// StartTierA runs the Prometheus-backed overlay loop until ctx is
// cancelled. Separate from Start/tick (Tier B) since it ticks on its own,
// much slower cadence and is a no-op entirely until a resolver is set.
func (s *Sampler) StartTierA(ctx context.Context) {
	go func() {
		s.tickTierA(ctx)
		ticker := time.NewTicker(s.promInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.tickTierA(ctx)
			}
		}
	}()
}

func (s *Sampler) tickTierA(ctx context.Context) {
	if s.promResolver == nil {
		return
	}
	for _, c := range s.mgr.List() {
		if !s.shouldSample(c) {
			continue
		}
		base := s.promResolver(c.ID)
		if base == "" {
			continue
		}
		cfg, err := s.mgr.RestConfig(c.ID)
		if err != nil {
			continue
		}
		cs, err := kubernetes.NewForConfig(cfg)
		if err != nil {
			s.log.Warn("waste tier A: client init failed", "cluster", c.ID, "err", err)
			continue
		}
		if err := s.tierAForCluster(ctx, c.ID, cs, base); err != nil {
			s.log.Warn("waste tier A: sample failed", "cluster", c.ID, "err", err)
		}
	}
}

// tierAForCluster takes its k8s client and Prometheus base URL as
// parameters (rather than constructing them) so it's testable against a
// fake clientset and a real httptest Prometheus server without a live
// cluster.
//
// Aggregation note: each pod's own p95 is queried individually and then
// summed across the pods of a workload — an approximation of the true p95
// of the aggregated series (sum-of-quantiles, not quantile-of-sum), chosen
// because it needs nothing beyond cAdvisor's own per-pod metrics through
// kubelet, with no kube-state-metrics label-join dependency. Good enough
// for "which workloads are meaningfully overprovisioned," not exact.
func (s *Sampler) tierAForCluster(ctx context.Context, clusterID string, cs kubernetes.Interface, promBase string) error {
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	pods, rsOwners, err := podsAndOwners(tctx, cs)
	if err != nil {
		return err
	}

	cpuByPod, err := s.queryPromVector(tctx, promBase, cpuP95Query(tierAWindow))
	if err != nil {
		return fmt.Errorf("cpu query: %w", err)
	}
	memByPod, err := s.queryPromVector(tctx, promBase, memP95Query(tierAWindow))
	if err != nil {
		return fmt.Errorf("mem query: %w", err)
	}
	coverageByPod, err := s.queryPromVector(tctx, promBase, coverageQuery(tierAWindow))
	if err != nil {
		return fmt.Errorf("coverage query: %w", err)
	}

	expected := expectedSteps(7*24*time.Hour, tierAStep)

	type acc struct {
		cpuMillis  float64
		memBytes   float64
		allCovered bool
		sawAny     bool
	}
	accs := map[WorkloadKey]*acc{}

	for _, pod := range pods.Items {
		owner := controllerOwner(pod.OwnerReferences)
		kind, name, ok := resolveWorkload(podRef{Owner: owner}, rsOwners)
		if !ok {
			continue
		}
		podKey := pod.Namespace + "/" + pod.Name
		cpuVal, hasCPU := cpuByPod[podKey]
		memVal, hasMem := memByPod[podKey]
		if !hasCPU && !hasMem {
			continue
		}
		covered := hasSufficientCoverage(coverageByPod[podKey], expected)

		key := WorkloadKey{Cluster: clusterID, Ns: pod.Namespace, Kind: kind, Name: name}
		a, ok := accs[key]
		if !ok {
			a = &acc{allCovered: true}
			accs[key] = a
		}
		a.sawAny = true
		if !covered {
			a.allCovered = false
		}
		a.cpuMillis += cpuVal * 1000
		a.memBytes += memVal
	}

	now := time.Now()
	s.mu.Lock()
	for key, a := range accs {
		if !a.sawAny || !a.allCovered {
			// A pod without enough history yet (e.g. recently rescheduled)
			// means the workload's true total is undercounted here — fall
			// back to Tier B/omit rather than show a partial number.
			delete(s.tierA, key)
			continue
		}
		s.tierA[key] = tierAEntry{
			CPUP95Millis: int64(a.cpuMillis),
			MemP95Bytes:  int64(a.memBytes),
			Window:       fmt.Sprintf("%s probed (Prometheus, updated %s UTC)", tierAWindow, now.UTC().Format("15:04")),
		}
	}
	s.mu.Unlock()

	return nil
}

func (s *Sampler) queryPromVector(ctx context.Context, base, query string) (map[string]float64, error) {
	target, err := url.Parse(base + "/api/v1/query")
	if err != nil {
		return nil, err
	}
	q := target.Query()
	q.Set("query", query)
	target.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prometheus returned %d: %s", resp.StatusCode, string(body))
	}
	return parsePromVectorByPodKey(body)
}

// podsAndOwners lists every pod and resolves ReplicaSet->Deployment
// ownership in one pass — shared by Tier B's sampleCluster and Tier A's
// tierAForCluster so both use identical workload attribution.
func podsAndOwners(ctx context.Context, cs kubernetes.Interface) (*corev1.PodList, map[string]ownerRef, error) {
	pods, err := cs.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, nil, err
	}
	rss, err := cs.AppsV1().ReplicaSets(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, nil, err
	}
	rsOwners := map[string]ownerRef{}
	for _, rs := range rss.Items {
		if ref := controllerOwner(rs.OwnerReferences); ref != nil {
			rsOwners[string(rs.UID)] = *ref
		}
	}
	return pods, rsOwners, nil
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
		if !s.shouldSample(c) {
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
	pods, rsOwners, err := podsAndOwners(tctx, cs)
	if err != nil {
		return err
	}

	metricsByPod := map[string]podUsage{}
	pmList, merr := mc.MetricsV1beta1().PodMetricses(metav1.NamespaceAll).List(tctx, metav1.ListOptions{})
	metricsOK := merr == nil
	if metricsOK {
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

	now := time.Now()
	record := s.recorder != nil && s.recordFilter != nil && s.recordFilter(clusterID)
	nsTotals := map[string]*NsUsage{}
	tickRequested := map[WorkloadKey]reqTotals{}
	tickUsage := map[WorkloadKey]podUsage{}
	tickHasUsage := map[WorkloadKey]bool{}

	for _, pod := range pods.Items {
		// Namespace totals come first, before owner resolution drops bare pods.
		if record && pod.Status.Phase != corev1.PodSucceeded && pod.Status.Phase != corev1.PodFailed {
			addNsTotals(nsTotals, pod, metricsByPod, metricsOK)
		}
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
		rt.PodCount++
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

	if record {
		usage := []NsUsage{{Ns: "", HasUsage: metricsOK}}
		for _, u := range nsTotals {
			usage[0].CPUMillis += u.CPUMillis
			usage[0].MemBytes += u.MemBytes
			usage[0].ReqCPUMillis += u.ReqCPUMillis
			usage[0].ReqMemBytes += u.ReqMemBytes
			usage = append(usage, *u)
		}
		s.recorder(ctx, clusterID, cs, now, usage)
	}
	return nil
}

func addNsTotals(totals map[string]*NsUsage, pod corev1.Pod, metricsByPod map[string]podUsage, metricsOK bool) {
	t := totals[pod.Namespace]
	if t == nil {
		t = &NsUsage{Ns: pod.Namespace, HasUsage: metricsOK}
		totals[pod.Namespace] = t
	}
	for _, c := range pod.Spec.Containers {
		t.ReqCPUMillis += c.Resources.Requests.Cpu().MilliValue()
		t.ReqMemBytes += c.Resources.Requests.Memory().Value()
	}
	if u, ok := metricsByPod[pod.Namespace+"/"+pod.Name]; ok {
		t.CPUMillis += u.CPUMillis
		t.MemBytes += u.MemBytes
	}
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
// stop") is omitted rather than shown with a fabricated zero. Tier A
// (Prometheus), when available and sufficiently probed for a workload, wins
// over Tier B (metrics-server) for that workload — a 7d PromQL percentile is
// a strictly better recommendation than a 3h in-memory ring buffer.
func (s *Sampler) Snapshot(clusterID string) []WorkloadWaste {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	out := make([]WorkloadWaste, 0)
	for key, rt := range s.requested {
		if key.Cluster != clusterID {
			continue
		}
		if tierA, ok := s.tierA[key]; ok {
			out = append(out, WorkloadWaste{
				Cluster:            clusterID,
				Ns:                 key.Ns,
				Kind:               key.Kind,
				Name:               key.Name,
				PodCount:           rt.PodCount,
				RequestedCPUMillis: rt.CPUMillis,
				RequestedMemBytes:  rt.MemBytes,
				P95CPUMillis:       tierA.CPUP95Millis,
				P95MemBytes:        tierA.MemP95Bytes,
				Source:             "prometheus",
				Window:             tierA.Window,
			})
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
			PodCount:           rt.PodCount,
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
