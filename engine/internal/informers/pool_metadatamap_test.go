package informers

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

	"github.com/RajaSardar/kubebay/engine/internal/timeline"
)

func ptr[T any](v T) *T { return &v }

func metadataCases() []*metav1.PartialObjectMetadata {
	var out []*metav1.PartialObjectMetadata
	for i := 0; i < 50; i++ {
		out = append(out, metaPod(i))
	}
	del := metav1.NewTime(time.Date(2026, 11, 2, 3, 4, 5, 0, time.FixedZone("x", 3600)))
	out = append(out,
		&metav1.PartialObjectMetadata{},
		&metav1.PartialObjectMetadata{
			TypeMeta: metav1.TypeMeta{APIVersion: "meta.k8s.io/v1", Kind: "PartialObjectMetadata"},
			ObjectMeta: metav1.ObjectMeta{
				Name: "n", Namespace: "ns", UID: "u", ResourceVersion: "7", Generation: 5, SelfLink: "/x",
				DeletionTimestamp: &del, DeletionGracePeriodSeconds: ptr(int64(30)),
				Labels: map[string]string{}, Annotations: map[string]string{"a": ""},
				Finalizers: []string{"f1", "f2"},
				OwnerReferences: []metav1.OwnerReference{
					{APIVersion: "v1", Kind: "Node", Name: "n1", UID: "o1"},
					{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "r", UID: "o2", Controller: ptr(false), BlockOwnerDeletion: ptr(true)},
				},
				ManagedFields: []metav1.ManagedFieldsEntry{
					{Manager: "m"},
					{Manager: "k", Operation: metav1.ManagedFieldsOperationApply, APIVersion: "v1", Time: &del, FieldsType: "FieldsV1", Subresource: "status"},
				},
			},
		},
		&metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{Name: "empty-lists", Finalizers: []string{}, OwnerReferences: []metav1.OwnerReference{}, ManagedFields: []metav1.ManagedFieldsEntry{}}},
	)
	return out
}

// The hand-written conversion is exactly what the reflection converter made
// (so timeline diffs are unchanged), and the same JSON as the round trip the
// stream sent (so frames carry the same values).
func TestMetadataMapMatchesTheConverters(t *testing.T) {
	for i, o := range metadataCases() {
		want, err := runtime.DefaultUnstructuredConverter.ToUnstructured(o)
		if err != nil {
			t.Fatal(err)
		}
		got := metadataMap(o)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("case %d:\n got %#v\nwant %#v", i, got, want)
		}
		gj, _ := json.Marshal(got)
		wj, _ := json.Marshal(jsonToMap(o))
		var ga, wa any
		_ = json.Unmarshal(gj, &ga)
		_ = json.Unmarshal(wj, &wa)
		if !reflect.DeepEqual(ga, wa) {
			t.Fatalf("case %d JSON:\n got %s\nwant %s", i, gj, wj)
		}
	}
}

// jsonToMap is the JSON round trip ops were made with before the
// hand-written conversion; frames must carry the same values.
func jsonToMap(v any) map[string]any {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil
	}
	return m
}

// A metadata informer's object stays typed in the cache, with fieldsV1 and
// last-applied trimmed: as a map it would hold four times the memory (see
// TestCacheHeap2000Pods).
func TestMetadataTransformKeepsTheTrimmedTypedObject(t *testing.T) {
	o := metaPod(1)
	o.Annotations[lastAppliedAnnotation] = `{"big":"manifest"}`
	o.ManagedFields[0].FieldsV1 = &metav1.FieldsV1{Raw: []byte(`{"f:spec":{}}`)}
	got, err := trimManagedFields(o)
	if err != nil {
		t.Fatal(err)
	}
	pm, ok := got.(*metav1.PartialObjectMetadata)
	if !ok {
		t.Fatalf("stored %T, want *metav1.PartialObjectMetadata", got)
	}
	if pm.Annotations[lastAppliedAnnotation] != lastAppliedTrimmed {
		t.Error("last-applied was not trimmed")
	}
	for _, mf := range pm.ManagedFields {
		if mf.FieldsV1 != nil {
			t.Error("fieldsV1 was kept")
		}
	}
	// An op made from it is the hand-written map, with no field sets.
	op, ok := opOf("MODIFIED", pm)
	if !ok || !reflect.DeepEqual(op.Obj, metadataMap(pm)) {
		t.Fatalf("op = %+v", op)
	}
	if u := (&unstructured.Unstructured{Object: op.Obj}); u.GetName() != o.Name || u.GetNamespace() != o.Namespace {
		t.Fatalf("op object %v/%v", u.GetNamespace(), u.GetName())
	}
}

// Per event, a metadata-mode op and timeline observation used to cost 194
// and 232 allocations (a JSON and a reflection round trip). Made by hand
// from the typed object they cost about 72 and twice that.
func TestMetadataEventAllocationBudget(t *testing.T) {
	stored := func(rv string) any {
		o := metaPod(1)
		o.ResourceVersion = rv
		s, _ := trimManagedFields(o)
		return s
	}
	old, nw := stored("1000"), stored("1001")
	if n := testing.AllocsPerRun(100, func() { _, _ = opOf("MODIFIED", nw) }); n > 90 {
		t.Errorf("opOf on a metadata object: %.0f allocs, budget 90 (was 194)", n)
	}
	if n := testing.AllocsPerRun(100, func() {
		_, _ = toObserved(timeline.OpUpdate, old, nw, "", "v1", "pods", ModeMetadata)
	}); n > 180 {
		t.Errorf("toObserved on a metadata update: %.0f allocs, budget 180 (was 232)", n)
	}
	ob, ok := toObserved(timeline.OpUpdate, old, nw, "", "v1", "pods", ModeMetadata)
	if !ok || ob.ObjKind != "" || !ob.MetadataOnly {
		t.Fatalf("observed %+v", ob)
	}
}
