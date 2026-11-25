package informers

import (
	"strings"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

const lastApplied = "kubectl.kubernetes.io/last-applied-configuration"

// The annotation is a whole copy of the manifest, so every cached object
// carrying one costs twice. The key stays so the drawer still lists it.
func TestTrimDropsLastAppliedConfigurationValue(t *testing.T) {
	big := strings.Repeat("x", 4096)

	u := &unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"annotations": map[string]any{lastApplied: big, "team": "payments"}},
	}}
	out, _ := trimManagedFields(u)
	ann := out.(*unstructured.Unstructured).Object["metadata"].(map[string]any)["annotations"].(map[string]any)
	if v, ok := ann[lastApplied]; !ok || len(v.(string)) > 64 {
		t.Fatalf("unstructured: want key kept with a short value, got %v (present=%v)", v, ok)
	}
	if ann["team"] != "payments" {
		t.Fatalf("other annotations must be untouched, got %v", ann["team"])
	}

	pm := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{Annotations: map[string]string{lastApplied: big, "team": "payments"}}}
	out, _ = trimManagedFields(pm)
	got := out.(*metav1.PartialObjectMetadata).Annotations
	if len(got[lastApplied]) > 64 || got["team"] != "payments" {
		t.Fatalf("metadata: got %v", got)
	}
}

func TestTrimLeavesObjectWithoutAnnotationsAlone(t *testing.T) {
	u := &unstructured.Unstructured{Object: map[string]any{"metadata": map[string]any{"name": "a"}}}
	out, _ := trimManagedFields(u)
	if _, has := out.(*unstructured.Unstructured).Object["metadata"].(map[string]any)["annotations"]; has {
		t.Fatal("must not invent an annotations map")
	}
}

func TestEvictAfterIsShortEnoughToFreeIdleCaches(t *testing.T) {
	if evictAfter > 2*60*1e9 {
		t.Fatalf("evictAfter = %v, want <= 2m", evictAfter)
	}
}
