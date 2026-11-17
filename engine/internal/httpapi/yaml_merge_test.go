package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/types"
)

const kedaPausePatch = `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: so1
  namespace: default
  annotations:
    autoscaling.keda.sh/paused-replicas: "2"
    autoscaling.keda.sh/paused: null
`

func TestApplyYAMLMergeModePatchesCustomResourcesAndNullRemoves(t *testing.T) {
	c, got := editChannels(t)
	body := editBody("", kedaPausePatch, false)
	delete(body, "original")
	body["mode"] = "merge"
	body["action"] = "keda-pause"
	body["gvr"] = "keda.sh/v1alpha1/scaledobjects"
	body["ns"] = "default"
	body["name"] = "so1"
	rr, resp := putYAML(t, c, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	if got.action.PatchType != types.MergePatchType {
		t.Errorf("patch type = %s, want JSON merge patch (null deletes an annotation)", got.action.PatchType)
	}
	p := string(got.action.Patch)
	if !strings.Contains(p, `"autoscaling.keda.sh/paused":null`) || !strings.Contains(p, `"autoscaling.keda.sh/paused-replicas":"2"`) {
		t.Errorf("patch = %s", p)
	}
	if strings.Contains(p, "apiVersion") || strings.Contains(p, "\"name\"") {
		t.Errorf("patch carries identity fields: %s", p)
	}
	if got.opts.FieldManager != "kubebay" {
		t.Errorf("manager = %q", got.opts.FieldManager)
	}
	if resp["patchType"] != "merge" {
		t.Errorf("response patchType = %v", resp["patchType"])
	}
}
