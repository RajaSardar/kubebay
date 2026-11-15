package waste

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	metadatafake "k8s.io/client-go/metadata/fake"
)

// A cluster you have open is sampled every tick. One that is only enrolled in
// usage history (the engine records it whether or not you are looking) is
// sampled every ten minutes: a full pod and ReplicaSet list a minute for every
// cluster you have ever opened is megabytes a minute of decoding, all day.
func TestAnOpenClusterIsSampledEveryTick(t *testing.T) {
	s := NewSampler(nil, discardLogger())
	s.SetConnected(func(id string) bool { return id == "open" })
	t0 := time.Now()
	s.markSampled("open", t0)
	if !s.dueNow("open", t0.Add(61*time.Second)) {
		t.Error("an open cluster is due again on the next tick")
	}
}

func TestAClusterOnlyEnrolledInHistoryIsSampledEveryTenMinutes(t *testing.T) {
	s := NewSampler(nil, discardLogger())
	s.SetConnected(func(string) bool { return false })
	t0 := time.Now()
	if !s.dueNow("history", t0) {
		t.Fatal("a cluster never sampled is due at once")
	}
	s.markSampled("history", t0)
	if s.dueNow("history", t0.Add(9*time.Minute)) {
		t.Error("9 minutes is too soon for a cluster nobody has open")
	}
	if !s.dueNow("history", t0.Add(10*time.Minute)) {
		t.Error("10 minutes is due")
	}
}

func TestAClusterBecomingOpenIsSampledAtOnce(t *testing.T) {
	open := false
	s := NewSampler(nil, discardLogger())
	s.SetConnected(func(string) bool { return open })
	t0 := time.Now()
	s.markSampled("c", t0)
	if s.dueNow("c", t0.Add(time.Minute)) {
		t.Fatal("not due while closed")
	}
	open = true
	if !s.dueNow("c", t0.Add(time.Minute)) {
		t.Error("opening a cluster should not wait out the ten minutes")
	}
}

func TestWithoutAnOpenHookEveryClusterIsSampledEveryTick(t *testing.T) {
	s := NewSampler(nil, discardLogger())
	t0 := time.Now()
	s.markSampled("c", t0)
	if !s.dueNow("c", t0.Add(time.Second)) {
		t.Error("the default is the old behaviour: every tick")
	}
}

// ReplicaSets are listed only to learn which Deployment owns each: their names
// and owner references, not their pod templates.
func TestReplicaSetOwnersFromMetadataMatchTheFullList(t *testing.T) {
	scheme := runtime.NewScheme()
	if err := metav1.AddMetaToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	owned := &metav1.PartialObjectMetadata{
		TypeMeta:   metav1.TypeMeta{APIVersion: "apps/v1", Kind: "ReplicaSet"},
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "app-rs", UID: "rs-uid-1", OwnerReferences: []metav1.OwnerReference{{Kind: "Deployment", Name: "app", UID: types.UID("dep-uid-1"), Controller: boolPtr(true)}}},
	}
	orphan := &metav1.PartialObjectMetadata{
		TypeMeta:   metav1.TypeMeta{APIVersion: "apps/v1", Kind: "ReplicaSet"},
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "loose-rs", UID: "rs-uid-2"},
	}
	got, err := replicaSetOwnersMeta(context.Background(), metadatafake.NewSimpleMetadataClient(scheme, owned, orphan))
	if err != nil {
		t.Fatal(err)
	}
	rs := replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1")
	want, err := replicaSetOwners(context.Background(), fake.NewSimpleClientset(&rs))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got["rs-uid-1"] != want["rs-uid-1"] {
		t.Errorf("got %+v, want %+v (the same owner the full list gives, and nothing for a ReplicaSet with no controller)", got, want)
	}
}

func TestSamplingWithPrecomputedOwnersGivesTheSameRowsAsListingThem(t *testing.T) {
	pod := deploymentOwnedPod("default", "app-1", "rs-uid-1", "100m", "128Mi")
	rs := replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1")
	mc := newFakeMetricsClient(podMetrics("default", "app-1", "50m", "64Mi"))

	a := NewSampler(nil, discardLogger())
	if err := a.sampleCluster(context.Background(), "c", fake.NewSimpleClientset(&pod, &rs), mc); err != nil {
		t.Fatal(err)
	}
	b := NewSampler(nil, discardLogger())
	owners := map[string]ownerRef{"rs-uid-1": {Kind: "Deployment", Name: "app"}}
	if err := b.sampleWithOwners(context.Background(), "c", fake.NewSimpleClientset(&pod), mc, owners); err != nil {
		t.Fatal(err)
	}
	ra, rb := a.Snapshot("c"), b.Snapshot("c")
	if len(ra) != 1 || len(rb) != 1 || ra[0].Name != rb[0].Name || ra[0].RequestedCPUMillis != rb[0].RequestedCPUMillis || ra[0].P95CPUMillis != rb[0].P95CPUMillis {
		t.Errorf("listing the owners %+v, precomputing them %+v", ra, rb)
	}
	_ = corev1.Pod{}
}
