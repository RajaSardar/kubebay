package waste

import (
	"context"
	"io"
	"log/slog"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	fakemetrics "k8s.io/metrics/pkg/client/clientset/versioned/fake"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// newFakeMetricsClient builds a fake metrics clientset that actually returns
// the given items on List. The generated fake_podmetrics.go registers its
// List action under resource "pods" (matching the real metrics.k8s.io API,
// which oddly names the resource "pods" rather than "podmetricses"), but
// NewSimpleClientset's default object tracker guesses the resource name from
// the Go Kind ("PodMetrics" -> "podmetricses") — a mismatch that silently
// makes every List() return empty. A reactor sidesteps the tracker entirely.
func newFakeMetricsClient(items ...metricsv1beta1.PodMetrics) metricsv.Interface {
	mc := fakemetrics.NewSimpleClientset()
	mc.PrependReactor("list", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		return true, &metricsv1beta1.PodMetricsList{Items: items}, nil
	})
	return mc
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func boolPtr(b bool) *bool { return &b }

func deploymentOwnedPod(ns, name, rsUID string, cpuReq, memReq string) corev1.Pod {
	return corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: ns,
			Name:      name,
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "ReplicaSet", Name: name + "-rs", UID: types.UID(rsUID), Controller: boolPtr(true)},
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "app",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse(cpuReq),
							corev1.ResourceMemory: resource.MustParse(memReq),
						},
					},
				},
			},
		},
	}
}

func replicaSet(ns, name, uid, depUID string) appsv1.ReplicaSet {
	return appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: ns,
			Name:      name,
			UID:       types.UID(uid),
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "Deployment", Name: "app", UID: types.UID(depUID), Controller: boolPtr(true)},
			},
		},
	}
}

func podMetrics(ns, name, cpu, mem string) metricsv1beta1.PodMetrics {
	return metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name},
		Containers: []metricsv1beta1.ContainerMetrics{
			{
				Name: "app",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse(cpu),
					corev1.ResourceMemory: resource.MustParse(mem),
				},
			},
		},
	}
}

func TestSampleCluster_AggregatesToWorkloadLevel(t *testing.T) {
	pod1 := deploymentOwnedPod("default", "app-1", "rs-uid-1", "100m", "128Mi")
	pod2 := deploymentOwnedPod("default", "app-2", "rs-uid-1", "100m", "128Mi")
	rs := replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1")

	cs := fake.NewSimpleClientset(&pod1, &pod2, &rs)
	mc := newFakeMetricsClient(
		podMetrics("default", "app-1", "50m", "64Mi"),
		podMetrics("default", "app-2", "30m", "32Mi"),
	)

	s := NewSampler(nil, discardLogger())
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, mc); err != nil {
		t.Fatalf("sampleCluster: %v", err)
	}

	rows := s.Snapshot("kind-dev")
	if len(rows) != 1 {
		t.Fatalf("want 1 workload row, got %d: %+v", len(rows), rows)
	}
	r := rows[0]
	if r.Kind != "Deployment" || r.Name != "app" || r.Ns != "default" {
		t.Errorf("row identity = %+v, want Deployment/default/app", r)
	}
	if r.PodCount != 2 {
		t.Errorf("PodCount = %d, want 2", r.PodCount)
	}
	// requested: 100m+100m = 200m; usage: 50m+30m = 80m
	if r.RequestedCPUMillis != 200 {
		t.Errorf("RequestedCPUMillis = %d, want 200", r.RequestedCPUMillis)
	}
	if r.P95CPUMillis != 80 {
		t.Errorf("P95CPUMillis = %d, want 80 (single-sample p95 == the sample)", r.P95CPUMillis)
	}
	if r.Source != "metrics-server" {
		t.Errorf("Source = %q, want metrics-server", r.Source)
	}
	if r.Window == "" {
		t.Error("Window should be non-empty once a sample exists")
	}
}

func TestSampleCluster_UpdatesRequestedEvenWithoutMetrics(t *testing.T) {
	pod := deploymentOwnedPod("default", "app-1", "rs-uid-1", "250m", "256Mi")
	rs := replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1")
	cs := fake.NewSimpleClientset(&pod, &rs)
	mc := newFakeMetricsClient() // no metrics-server data at all

	s := NewSampler(nil, discardLogger())
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, mc); err != nil {
		t.Fatalf("sampleCluster: %v", err)
	}

	// Tier C: requests known but no usage sample yet -> omitted from Snapshot,
	// not shown with a fabricated zero.
	rows := s.Snapshot("kind-dev")
	if len(rows) != 0 {
		t.Fatalf("want 0 rows (no usage data yet), got %d: %+v", len(rows), rows)
	}
}

func TestSampleCluster_ExcludesBarePodsAndUnresolvedOwners(t *testing.T) {
	barePod := corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "bare"}}
	cs := fake.NewSimpleClientset(&barePod)
	mc := newFakeMetricsClient(podMetrics("default", "bare", "10m", "10Mi"))

	s := NewSampler(nil, discardLogger())
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, mc); err != nil {
		t.Fatalf("sampleCluster: %v", err)
	}
	if rows := s.Snapshot("kind-dev"); len(rows) != 0 {
		t.Errorf("want 0 rows for a bare pod, got %d: %+v", len(rows), rows)
	}
}

func TestSnapshot_ScopedByCluster(t *testing.T) {
	podA := deploymentOwnedPod("default", "app-1", "rs-uid-1", "100m", "128Mi")
	rsA := replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1")
	csA := fake.NewSimpleClientset(&podA, &rsA)
	mcA := newFakeMetricsClient(podMetrics("default", "app-1", "50m", "64Mi"))

	s := NewSampler(nil, discardLogger())
	if err := s.sampleCluster(context.Background(), "cluster-a", csA, mcA); err != nil {
		t.Fatalf("sampleCluster: %v", err)
	}

	if rows := s.Snapshot("cluster-b"); len(rows) != 0 {
		t.Errorf("Snapshot for a different cluster should be empty, got %d rows", len(rows))
	}
	if rows := s.Snapshot("cluster-a"); len(rows) != 1 {
		t.Errorf("Snapshot for cluster-a should have 1 row, got %d", len(rows))
	}
}

// The sampler LISTs pods on a cluster every minute. Only clusters the user
// connected to, or enrolled in usage history, may be polled; a production
// context that merely answers /version must not be.
func TestSamplerOnlyPollsConnectedOrEnrolledClusters(t *testing.T) {
	s := &Sampler{}
	reach := clusters.Cluster{ID: "prod", Status: clusters.StatusConnected}
	if !s.shouldSample(reach) {
		t.Error("with no gate set the sampler keeps its old behaviour")
	}
	s.SetGate(func(id string) bool { return id == "dev" })
	if s.shouldSample(reach) {
		t.Error("a reachable cluster the gate rejects must not be sampled")
	}
	if !s.shouldSample(clusters.Cluster{ID: "dev", Status: clusters.StatusConnected}) {
		t.Error("a gated-in reachable cluster is sampled")
	}
	if s.shouldSample(clusters.Cluster{ID: "dev", Status: clusters.StatusUnreachable}) {
		t.Error("an unreachable cluster is never sampled")
	}
}
