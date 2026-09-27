// Package waste implements a usage-based right-sizing recommender shared
// between the VPA/right-sizing flow and the Cost/Waste view (see the
// innovation backlog's "boundary with #4" note: one recommender, two
// renderers). This is Tier B only — metrics-server point-in-time samples
// accumulated into a rolling window — never a Prometheus-backed percentile.
// Labeling every result with its actual sample count and window keeps a
// thin history from being presented as more confident than it is.
package waste

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// Sample is one metrics-server observation for a workload at a point in time.
type Sample struct {
	Time      time.Time
	CPUMillis int64
	MemBytes  int64
}

// percentile returns the nearest-rank percentile (p in [0,1]) of values.
// Nearest-rank (not interpolated) so every returned value is an observation
// that was actually seen, never a synthesized number between two samples —
// deliberately conservative for an honesty-first recommendation.
func percentile(values []int64, p float64) int64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	idx := int(p*float64(len(sorted))+0.9999999) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

// ringBuffer holds up to `cap` samples for one workload, evicting the oldest
// once full — an in-memory-only window that dies on restart, by design (see
// the backlog: a local sampler with gapped history lies about percentiles).
type ringBuffer struct {
	mu      sync.Mutex
	samples []Sample
	cap     int
}

func newRingBuffer(capacity int) *ringBuffer {
	return &ringBuffer{cap: capacity}
}

func (r *ringBuffer) add(s Sample) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.samples = append(r.samples, s)
	if len(r.samples) > r.cap {
		r.samples = r.samples[len(r.samples)-r.cap:]
	}
}

func (r *ringBuffer) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.samples)
}

func (r *ringBuffer) percentileCPUMem(p float64) (cpu, mem int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cpus := make([]int64, len(r.samples))
	mems := make([]int64, len(r.samples))
	for i, s := range r.samples {
		cpus[i] = s.CPUMillis
		mems[i] = s.MemBytes
	}
	return percentile(cpus, p), percentile(mems, p)
}

// windowLabel honestly reports the observed span and sample count — e.g.
// "observed over 3h, 180 samples" — or "" when there is nothing yet.
func (r *ringBuffer) windowLabel(now time.Time) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.samples) == 0 {
		return ""
	}
	oldest := r.samples[0].Time
	span := now.Sub(oldest)
	return fmt.Sprintf("observed over %s, %d sample%s", fmtDuration(span), len(r.samples), plural(len(r.samples)))
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func fmtDuration(d time.Duration) string {
	if d < time.Minute {
		return "less than a minute"
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	h := int(d.Hours())
	m := int(d.Minutes()) - h*60
	if m == 0 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dh%dm", h, m)
}

// ownerRef is a minimal ownerReferences entry.
type ownerRef struct {
	Kind string
	Name string
	UID  string
}

// podRef is the minimal pod shape resolveWorkload needs: its controller
// owner, if any (the first ownerReference with controller:true in practice —
// callers are expected to have already picked that one).
type podRef struct {
	Owner *ownerRef
}

// workloadKinds this recommender attributes usage to — the same scope VPA
// v1 and Karpenter already settled on: Jobs/CronJobs and bare pods are
// excluded rather than guessed at.
var workloadKinds = map[string]bool{
	"StatefulSet": true,
	"DaemonSet":   true,
}

// resolveWorkload maps a pod to the Deployment/StatefulSet/DaemonSet that
// owns it. A pod owned by a ReplicaSet resolves one hop further to that
// ReplicaSet's own Deployment owner (rsOwners, built from a live
// ReplicaSet list); a pod owned directly by a StatefulSet/DaemonSet
// resolves immediately. Anything else (bare pods, Jobs/CronJobs, an
// unrecognized or unknown ReplicaSet) does not resolve — silently
// excluding it is safer than guessing at attribution.
func resolveWorkload(pod podRef, rsOwners map[string]ownerRef) (kind, name string, ok bool) {
	if pod.Owner == nil {
		return "", "", false
	}
	if pod.Owner.Kind == "ReplicaSet" {
		dep, found := rsOwners[pod.Owner.UID]
		if !found || dep.Kind != "Deployment" {
			return "", "", false
		}
		return dep.Kind, dep.Name, true
	}
	if workloadKinds[pod.Owner.Kind] {
		return pod.Owner.Kind, pod.Owner.Name, true
	}
	return "", "", false
}

// WorkloadKey identifies one workload within one cluster.
type WorkloadKey struct {
	Cluster string
	Ns      string
	Kind    string
	Name    string
}

// WorkloadWaste is the shared recommender's output row — rendered as a
// per-workload banner by the right-sizing flow and as a sorted table by the
// Cost/Waste view (one recommender, two renderers, per the backlog).
type WorkloadWaste struct {
	Cluster            string `json:"cluster"`
	Ns                 string `json:"ns"`
	Kind               string `json:"kind"`
	Name               string `json:"name"`
	PodCount           int    `json:"podCount"`
	RequestedCPUMillis int64  `json:"requestedCpuMillis"`
	RequestedMemBytes  int64  `json:"requestedMemBytes"`
	P95CPUMillis       int64  `json:"p95CpuMillis"`
	P95MemBytes        int64  `json:"p95MemBytes"`
	Source             string `json:"source"`
	Window             string `json:"window"`
}
