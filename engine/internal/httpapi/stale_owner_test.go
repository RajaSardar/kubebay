package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	k8stesting "k8s.io/client-go/testing"
)

func mf(manager string, op metav1.ManagedFieldsOperationType) metav1.ManagedFieldsEntry {
	return metav1.ManagedFieldsEntry{Manager: manager, Operation: op}
}

func TestStaleApplyOwnerPatchRemovesOnlyKubebayApplyEntries(t *testing.T) {
	entries := []metav1.ManagedFieldsEntry{
		mf("kubectl-client-side-apply", metav1.ManagedFieldsOperationUpdate),
		mf("kubebay", metav1.ManagedFieldsOperationApply),
		mf("kubebay", metav1.ManagedFieldsOperationUpdate),
		mf("helm", metav1.ManagedFieldsOperationApply),
	}
	raw := staleApplyOwnerPatch(entries)
	var ops []map[string]any
	if err := json.Unmarshal(raw, &ops); err != nil {
		t.Fatalf("patch %s: %v", raw, err)
	}
	want := []map[string]any{
		{"op": "test", "path": "/metadata/managedFields/1/manager", "value": "kubebay"},
		{"op": "test", "path": "/metadata/managedFields/1/operation", "value": "Apply"},
		{"op": "remove", "path": "/metadata/managedFields/1"},
	}
	if len(ops) != len(want) {
		t.Fatalf("ops = %v", ops)
	}
	for i := range want {
		for k, v := range want[i] {
			if ops[i][k] != v {
				t.Errorf("op %d: %v, want %v", i, ops[i], want[i])
			}
		}
	}
	if staleApplyOwnerPatch(entries[2:3]) != nil {
		t.Error("Kubebay's own Update entry is how edits are recorded now; it stays")
	}
}

func TestStaleApplyOwnerPatchRemovesFromTheEndSoIndexesHold(t *testing.T) {
	entries := []metav1.ManagedFieldsEntry{
		mf("kubebay", metav1.ManagedFieldsOperationApply),
		mf("kubectl", metav1.ManagedFieldsOperationUpdate),
		{Manager: "kubebay", Operation: metav1.ManagedFieldsOperationApply, Subresource: "status"},
	}
	var ops []map[string]any
	_ = json.Unmarshal(staleApplyOwnerPatch(entries), &ops)
	var removed []any
	for _, o := range ops {
		if o["op"] == "remove" {
			removed = append(removed, o["path"])
		}
	}
	if len(removed) != 2 || removed[0] != "/metadata/managedFields/2" || removed[1] != "/metadata/managedFields/0" {
		t.Errorf("removed %v, want highest index first", removed)
	}
}

func TestEditReleasesAStaleApplyOwnership(t *testing.T) {
	c, _ := editChannels(t, liveDeployment(t))
	var patches []k8stesting.PatchActionImpl
	d, _ := c.dynOverride(context.Background(), "c1")
	fake := d.(capDyn).Interface.(interface {
		PrependReactor(verb, resource string, fn k8stesting.ReactionFunc)
	})
	fake.PrependReactor("patch", "*", func(a k8stesting.Action) (bool, runtime.Object, error) {
		p := a.(k8stesting.PatchActionImpl)
		patches = append(patches, p)
		u := &unstructured.Unstructured{}
		u.SetAPIVersion("apps/v1")
		u.SetKind("Deployment")
		u.SetName("debugging-apis-fml-in")
		u.SetNamespace("debug")
		if p.PatchType != types.JSONPatchType {
			u.SetManagedFields([]metav1.ManagedFieldsEntry{
				mf("kubectl-client-side-apply", metav1.ManagedFieldsOperationUpdate),
				mf("kubebay", metav1.ManagedFieldsOperationApply),
				mf("kubebay", metav1.ManagedFieldsOperationUpdate),
			})
		}
		return true, u, nil
	})

	rr, resp := putYAML(t, c, editBody(deployYAML, edit(deployYAML, "value: old-pwd", "value: new"), true))
	if rr.Code != http.StatusOK || len(patches) != 1 {
		t.Fatalf("dry run: %d, %d patches; a dry run must not touch ownership", rr.Code, len(patches))
	}
	patches = nil
	rr, resp = putYAML(t, c, editBody(deployYAML, edit(deployYAML, "value: old-pwd", "value: new"), false))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body)
	}
	if len(patches) != 2 || patches[1].PatchType != types.JSONPatchType {
		t.Fatalf("want the edit then a JSON patch releasing the stale Apply entry, got %d patches", len(patches))
	}
	if resp["releasedApplyOwnership"] != true {
		t.Errorf("response = %v", resp)
	}
}
