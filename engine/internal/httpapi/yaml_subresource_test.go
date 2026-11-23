package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
)

const rolloutStepPatch = `{"apiVersion":"argoproj.io/v1alpha1","kind":"Rollout","metadata":{"name":"web","namespace":"shop"},"status":{"currentStepIndex":3}}`

func rolloutBody() map[string]interface{} {
	return map[string]interface{}{
		"cluster": "c1", "gvr": "argoproj.io/v1alpha1/rollouts", "ns": "shop", "name": "web",
		"yaml": rolloutStepPatch, "mode": "merge", "subresource": "status", "action": "rollout-skip-step",
	}
}

// subresourceChannels records every patch; the status subresource answers
// NotFound when statusMissing is set, as it does on a CRD without one.
func subresourceChannels(t *testing.T, statusMissing bool) (*Channels, *[]k8stesting.PatchActionImpl) {
	t.Helper()
	cfg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", cfg)
	t.Setenv("HOME", cfg)
	lg, err := audit.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lg.Close() })
	client := dynfake.NewSimpleDynamicClient(runtime.NewScheme())
	var calls []k8stesting.PatchActionImpl
	client.PrependReactor("patch", "*", func(a k8stesting.Action) (bool, runtime.Object, error) {
		p := a.(k8stesting.PatchActionImpl)
		calls = append(calls, p)
		if statusMissing && p.GetSubresource() == "status" {
			return true, nil, apierrors.NewNotFound(schema.GroupResource{Group: "argoproj.io", Resource: "rollouts"}, "web")
		}
		u := &unstructured.Unstructured{}
		u.SetAPIVersion("argoproj.io/v1alpha1")
		u.SetKind("Rollout")
		u.SetName("web")
		u.SetNamespace("shop")
		return true, u, nil
	})
	c := &Channels{Audit: lg}
	c.dynOverride = func(context.Context, string) (dynamic.Interface, error) {
		return capDyn{client, &capturedPatch{}}, nil
	}
	return c, &calls
}

func TestApplyYAMLMergePatchesTheStatusSubresource(t *testing.T) {
	c, calls := subresourceChannels(t, false)
	rr, _ := putYAML(t, c, rolloutBody())
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	if len(*calls) != 1 {
		t.Fatalf("patches = %d, want 1", len(*calls))
	}
	p := (*calls)[0]
	if p.GetSubresource() != "status" {
		t.Errorf("subresource = %q, want status", p.GetSubresource())
	}
	if !strings.Contains(string(p.Patch), `"currentStepIndex":3`) {
		t.Errorf("patch = %s", p.Patch)
	}
	entries, _ := c.Audit.Tail(5)
	if len(entries) == 0 {
		t.Fatal("no audit entry")
	}
	last := entries[len(entries)-1]
	if last.Action != "rollout-skip-step" || !strings.Contains(last.Detail, "subresource=status") {
		t.Errorf("audit = %s %s, want the action and subresource=status", last.Action, last.Detail)
	}
}

// Argo Rollouts before v1.0 had no status subresource; kubectl-argo-rollouts
// falls back to the main resource on NotFound, and so does this.
func TestApplyYAMLStatusSubresourceFallsBackToMainResourceWhenMissing(t *testing.T) {
	c, calls := subresourceChannels(t, true)
	rr, _ := putYAML(t, c, rolloutBody())
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	if len(*calls) != 2 {
		t.Fatalf("patches = %d, want status then main resource", len(*calls))
	}
	if (*calls)[0].GetSubresource() != "status" || (*calls)[1].GetSubresource() != "" {
		t.Errorf("subresources = %q, %q", (*calls)[0].GetSubresource(), (*calls)[1].GetSubresource())
	}
	if string((*calls)[0].Patch) != string((*calls)[1].Patch) {
		t.Errorf("fallback patch differs: %s vs %s", (*calls)[0].Patch, (*calls)[1].Patch)
	}
}

func TestApplyYAMLRejectsOtherSubresources(t *testing.T) {
	c, calls := subresourceChannels(t, false)
	body := rolloutBody()
	body["subresource"] = "scale"
	rr, _ := putYAML(t, c, body)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rr.Code)
	}
	if len(*calls) != 0 {
		t.Errorf("a patch was sent")
	}
}

func TestApplyYAMLSubresourceOnlyWithMergeMode(t *testing.T) {
	c, calls := subresourceChannels(t, false)
	body := rolloutBody()
	delete(body, "mode")
	body["original"] = strings.Replace(rolloutStepPatch, `"currentStepIndex":3`, `"currentStepIndex":2`, 1)
	rr, _ := putYAML(t, c, body)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rr.Code)
	}
	if len(*calls) != 0 {
		t.Errorf("a patch was sent")
	}
}
