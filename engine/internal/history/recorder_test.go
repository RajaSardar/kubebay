package history

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestRecorder_FingerprintsOncePerClusterAndRecords(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	r := NewRecorder(s)
	if _, ok := r.FingerprintFor("kind-dev"); ok {
		t.Fatal("no fingerprint before anything is recorded")
	}
	ks := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kube-system", UID: "abc"}}
	cs := fake.NewSimpleClientset(ks)
	if err := r.Record(context.Background(), meta, cs, t0, []Obs{total(7, 1)}); err != nil {
		t.Fatal(err)
	}
	// The cached fingerprint is reused even if kube-system becomes unreadable.
	if err := r.Record(context.Background(), meta, fake.NewSimpleClientset(), t0.Add(time.Minute), []Obs{total(9, 1)}); err != nil {
		t.Fatal(err)
	}
	fp, ok := r.FingerprintFor("kind-dev")
	if !ok || fp != Fingerprint(context.Background(), cs, "", "") {
		t.Fatalf("fingerprint %q ok=%v", fp, ok)
	}
	ser, _ := s.Query(fp, "", t0, t0.Add(time.Hour))
	if ser.Points[0].Samples != 2 {
		t.Fatalf("want both ticks under one fingerprint, got %d", ser.Points[0].Samples)
	}
}

func TestRecorder_FindsExistingHistoryAfterRestart(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s1 := openTest(t, dir, c)
	_ = s1.Record("olderfp", meta, t0, []Obs{total(1, 1)})
	_ = s1.Record("newerfp", meta, t0.Add(time.Hour), []Obs{total(1, 1)})
	_ = s1.Close()
	s2 := openTest(t, dir, c)
	defer s2.Close()
	fp, ok := NewRecorder(s2).FingerprintFor("kind-dev")
	if !ok || fp != "newerfp" {
		t.Fatalf("want the most recently recorded fingerprint, got %q ok=%v", fp, ok)
	}
}

func TestRecorder_ForgetsErasedCluster(t *testing.T) {
	c := &clock{t0}
	s := openTest(t, t.TempDir(), c)
	defer s.Close()
	r := NewRecorder(s)
	_ = r.Record(context.Background(), meta, fake.NewSimpleClientset(), t0, []Obs{total(1, 1)})
	if n, err := r.Erase("kind-dev"); err != nil || n != 1 {
		t.Fatalf("erase n=%d err=%v", n, err)
	}
	if _, ok := r.FingerprintFor("kind-dev"); ok {
		t.Fatal("erased cluster must have no fingerprint")
	}
}
