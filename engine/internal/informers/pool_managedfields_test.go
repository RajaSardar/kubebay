package informers

import (
	"fmt"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// managedFields' field sets (fieldsV1) are most of an object's maps: 48 of
// the 51 in a pod's metadata. Nothing in Kubebay reads them; the Rollout tab
// reads each entry's time, so the entries stay.
func managedEntry() map[string]any {
	return map[string]any{
		"manager":    "kubectl-client-side-apply",
		"operation":  "Update",
		"apiVersion": "apps/v1",
		"time":       "2026-10-20T08:00:00Z",
		"fieldsType": "FieldsV1",
		"fieldsV1": map[string]any{
			"f:metadata": map[string]any{"f:labels": map[string]any{".": map[string]any{}, "f:app": map[string]any{}}},
			"f:spec":     map[string]any{"f:replicas": map[string]any{}},
		},
	}
}

func withManagedFields(obj map[string]any) map[string]any {
	obj["metadata"].(map[string]any)["managedFields"] = []any{managedEntry()}
	return obj
}

func checkTrimmed(t *testing.T, where string, obj map[string]any) {
	t.Helper()
	md, _ := obj["metadata"].(map[string]any)
	mf, _ := md["managedFields"].([]any)
	if len(mf) != 1 {
		t.Fatalf("%s: managedFields = %v, want its one entry kept", where, md["managedFields"])
	}
	e := mf[0].(map[string]any)
	if _, ok := e["fieldsV1"]; ok {
		t.Errorf("%s: managedFields entry still has fieldsV1", where)
	}
	for _, k := range []string{"manager", "operation", "time"} {
		if e[k] != managedEntry()[k] {
			t.Errorf("%s: managedFields %s = %v, want %v", where, k, e[k], managedEntry()[k])
		}
	}
}

func TestTrimManagedFieldsKeepsWhoAndWhenButNotTheFieldSets(t *testing.T) {
	u := &unstructured.Unstructured{Object: withManagedFields(deployment("shop", "api"))}
	out, err := trimManagedFields(u)
	if err != nil {
		t.Fatal(err)
	}
	checkTrimmed(t, "unstructured", out.(*unstructured.Unstructured).Object)

	when := metav1.NewTime(time.Date(2026, 10, 20, 8, 0, 0, 0, time.UTC))
	pm := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{Name: "api", ManagedFields: []metav1.ManagedFieldsEntry{{
		Manager: "kubectl-client-side-apply", Operation: metav1.ManagedFieldsOperationUpdate, Time: &when,
		FieldsType: "FieldsV1", FieldsV1: &metav1.FieldsV1{Raw: []byte(`{"f:spec":{"f:replicas":{}}}`)},
	}}}}
	out, err = trimManagedFields(pm)
	if err != nil {
		t.Fatal(err)
	}
	e := out.(*metav1.PartialObjectMetadata).ManagedFields[0]
	if e.FieldsV1 != nil {
		t.Errorf("metadata: managedFields entry still has fieldsV1 %s", e.FieldsV1.Raw)
	}
	if e.Manager != "kubectl-client-side-apply" || e.Time == nil || !e.Time.Equal(&when) {
		t.Errorf("metadata: managedFields entry = %+v, want manager and time kept", e)
	}

	if out, err := trimManagedFields("not an object"); err != nil || out != "not an object" {
		t.Errorf("anything else should pass through, got %v, %v", out, err)
	}
}

func TestTheStreamCarriesNoFieldSets(t *testing.T) {
	events := map[string]chan map[string]any{"shop": make(chan map[string]any, 1)}
	sub := subscribeFake(t, fakeDeployments{
		items:  map[string][]map[string]any{"shop": {withManagedFields(deployment("shop", "api"))}},
		events: events,
	}, "shop")

	select {
	case snap := <-sub.Snapshot():
		ops := snap.All()
		if len(ops) != 1 {
			t.Fatalf("snapshot = %v, want shop/api", names(ops))
		}
		checkTrimmed(t, "snapshot", ops[0].Obj)
	case <-time.After(5 * time.Second):
		t.Fatal("no snapshot")
	}

	events["shop"] <- withManagedFields(deployment("shop", "cart"))
	deadline := time.After(5 * time.Second)
	for {
		select {
		case ops := <-sub.Deltas():
			for _, op := range ops {
				if fmt.Sprint(names([]stream.Op{op})) == "[shop/cart]" {
					checkTrimmed(t, "delta", op.Obj)
					return
				}
			}
		case <-deadline:
			t.Fatal("no delta for shop/cart")
		}
	}
}
