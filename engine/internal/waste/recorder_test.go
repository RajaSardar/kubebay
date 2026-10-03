package waste

import (
	"context"
	"testing"
	"time"

	"errors"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
	fakemetrics "k8s.io/metrics/pkg/client/clientset/versioned/fake"
)

type recorded struct {
	cluster string
	usage   []NsUsage
}

func captureRecorder(enrolled map[string]bool) (*[]recorded, func(string) bool, UsageRecorder) {
	var got []recorded
	filter := func(id string) bool { return enrolled[id] }
	rec := func(_ context.Context, id string, _ kubernetes.Interface, _ time.Time, u []NsUsage) {
		got = append(got, recorded{id, u})
	}
	return &got, filter, rec
}

func byNs(u []NsUsage) map[string]NsUsage {
	out := map[string]NsUsage{}
	for _, x := range u {
		out[x.Ns] = x
	}
	return out
}

func TestSampleCluster_RecorderGetsNsTotalsIncludingBarePods(t *testing.T) {
	pod := deploymentOwnedPod("shop", "app-1", "rs-uid-1", "100m", "128Mi")
	rs := replicaSet("shop", "app-rs", "rs-uid-1", "dep-uid-1")
	bare := deploymentOwnedPod("tools", "debug", "", "50m", "64Mi")
	bare.OwnerReferences = nil
	done := deploymentOwnedPod("shop", "job-1", "", "900m", "1Gi")
	done.OwnerReferences = nil
	done.Status.Phase = corev1.PodSucceeded
	cs := fake.NewSimpleClientset(&pod, &rs, &bare, &done)
	mc := newFakeMetricsClient(podMetrics("shop", "app-1", "40m", "100Mi"), podMetrics("tools", "debug", "10m", "10Mi"))

	got, filter, rec := captureRecorder(map[string]bool{"kind-dev": true})
	s := NewSampler(nil, discardLogger())
	s.SetRecorder(filter, rec)
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, mc); err != nil {
		t.Fatal(err)
	}
	if len(*got) != 1 {
		t.Fatalf("want 1 recorder call, got %d", len(*got))
	}
	u := byNs((*got)[0].usage)
	if u["tools"].ReqCPUMillis != 50 || u["tools"].CPUMillis != 10 || !u["tools"].HasUsage {
		t.Fatalf("bare pod must count toward its namespace: %+v", u["tools"])
	}
	if u["shop"].ReqCPUMillis != 100 {
		t.Fatalf("finished pods hold no requests: %+v", u["shop"])
	}
	if u[""].ReqCPUMillis != 150 || u[""].CPUMillis != 50 || u[""].MemBytes != 110*1024*1024 {
		t.Fatalf("cluster total: %+v", u[""])
	}
}

func TestSampleCluster_RecorderOnlyForEnrolledClusters_SnapshotUnchanged(t *testing.T) {
	pod := deploymentOwnedPod("shop", "app-1", "rs-uid-1", "100m", "128Mi")
	rs := replicaSet("shop", "app-rs", "rs-uid-1", "dep-uid-1")
	mc := newFakeMetricsClient(podMetrics("shop", "app-1", "40m", "100Mi"))

	got, filter, rec := captureRecorder(map[string]bool{"kind-dev": true})
	withRec := NewSampler(nil, discardLogger())
	withRec.SetRecorder(filter, rec)
	plain := NewSampler(nil, discardLogger())
	for _, s := range []*Sampler{withRec, plain} {
		_ = s.sampleCluster(context.Background(), "prod", fake.NewSimpleClientset(&pod, &rs), mc)
	}
	if len(*got) != 0 {
		t.Fatalf("a cluster the user never connected to must not be recorded, got %+v", *got)
	}
	a, b := withRec.Snapshot("prod"), plain.Snapshot("prod")
	if len(a) != 1 || len(b) != 1 || a[0].P95CPUMillis != b[0].P95CPUMillis || a[0].RequestedCPUMillis != b[0].RequestedCPUMillis {
		t.Fatalf("the recorder must not change the snapshot: %+v vs %+v", a, b)
	}
}

func TestSampleCluster_RecorderMarksNoUsageWithoutMetricsServer(t *testing.T) {
	pod := deploymentOwnedPod("shop", "app-1", "rs-uid-1", "100m", "128Mi")
	rs := replicaSet("shop", "app-rs", "rs-uid-1", "dep-uid-1")
	mc := fakemetrics.NewSimpleClientset()
	mc.PrependReactor("list", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("the server could not find the requested resource")
	})

	got, filter, rec := captureRecorder(map[string]bool{"kind-dev": true})
	s := NewSampler(nil, discardLogger())
	s.SetRecorder(filter, rec)
	if err := s.sampleCluster(context.Background(), "kind-dev", fake.NewSimpleClientset(&pod, &rs), mc); err != nil {
		t.Fatal(err)
	}
	u := byNs((*got)[0].usage)
	if u[""].HasUsage || u["shop"].HasUsage {
		t.Fatalf("without metrics-server usage must be absent, not zero: %+v", u)
	}
	if u["shop"].ReqCPUMillis != 100 {
		t.Fatalf("requests are still recorded: %+v", u["shop"])
	}
}

func readyNode(name, cpu, mem string) *corev1.Node {
	return &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: name},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse(cpu), corev1.ResourceMemory: resource.MustParse(mem)},
		},
	}
}

func TestSampleCluster_RecorderGetsAllocatableAndNodeCount(t *testing.T) {
	pod := deploymentOwnedPod("shop", "app-1", "rs-uid-1", "100m", "128Mi")
	rs := replicaSet("shop", "app-rs", "rs-uid-1", "dep-uid-1")
	cs := fake.NewSimpleClientset(&pod, &rs, readyNode("n1", "2", "4Gi"), readyNode("n2", "1500m", "2Gi"))
	mc := newFakeMetricsClient(podMetrics("shop", "app-1", "40m", "100Mi"))

	got, filter, rec := captureRecorder(map[string]bool{"kind-dev": true})
	s := NewSampler(nil, discardLogger())
	s.SetRecorder(filter, rec)
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, mc); err != nil {
		t.Fatal(err)
	}
	tot := byNs((*got)[0].usage)[""]
	if tot.Nodes != 2 || tot.AllocCPUMillis != 3500 || tot.AllocMemBytes != 6<<30 {
		t.Fatalf("cluster total capacity: %+v", tot)
	}
	if ns := byNs((*got)[0].usage)["shop"]; ns.Nodes != 0 || ns.AllocCPUMillis != 0 {
		t.Fatalf("capacity belongs to the cluster total only: %+v", ns)
	}
}

func TestSampleCluster_NodeListFailureStillRecordsUsage(t *testing.T) {
	pod := deploymentOwnedPod("shop", "app-1", "rs-uid-1", "100m", "128Mi")
	rs := replicaSet("shop", "app-rs", "rs-uid-1", "dep-uid-1")
	cs := fake.NewSimpleClientset(&pod, &rs)
	cs.PrependReactor("list", "nodes", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("nodes is forbidden")
	})
	got, filter, rec := captureRecorder(map[string]bool{"kind-dev": true})
	s := NewSampler(nil, discardLogger())
	s.SetRecorder(filter, rec)
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, newFakeMetricsClient()); err != nil {
		t.Fatal(err)
	}
	tot := byNs((*got)[0].usage)[""]
	if tot.ReqCPUMillis != 100 || tot.Nodes != 0 {
		t.Fatalf("a forbidden node list leaves capacity unknown, usage intact: %+v", tot)
	}
}

// The drawer's 7-day chip: each tick, the cluster total names the workloads
// that are broken (podBroken), once each; namespace lines carry none.
func TestSampleCluster_RecorderGetsBrokenWorkloadsOnTheTotal(t *testing.T) {
	crashing := func(name string) corev1.Pod {
		p := deploymentOwnedPod("shop", name, "rs-uid-1", "100m", "128Mi")
		p.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "app", State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}}}}
		return p
	}
	a, b := crashing("app-1"), crashing("app-2")
	rs := replicaSet("shop", "app-rs", "rs-uid-1", "dep-uid-1")
	healthy := deploymentOwnedPod("shop", "web-1", "rs-uid-2", "100m", "128Mi")
	healthy.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "app", Ready: true}}
	rs2 := replicaSet("shop", "web-rs", "rs-uid-2", "dep-uid-2")
	rs2.OwnerReferences[0].Name = "web"
	cs := fake.NewSimpleClientset(&a, &b, &rs, &healthy, &rs2)

	got, filter, rec := captureRecorder(map[string]bool{"kind-dev": true})
	s := NewSampler(nil, discardLogger())
	s.SetRecorder(filter, rec)
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, newFakeMetricsClient()); err != nil {
		t.Fatal(err)
	}
	u := byNs((*got)[0].usage)
	if want := []string{"shop/Deployment/app"}; len(u[""].Broken) != 1 || u[""].Broken[0] != want[0] {
		t.Fatalf("cluster total Broken = %v, want %v", u[""].Broken, want)
	}
	if len(u["shop"].Broken) != 0 {
		t.Fatalf("namespace lines carry no broken list: %v", u["shop"].Broken)
	}
}
