package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	dynfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
)

type capturedPatch struct {
	action k8stesting.PatchActionImpl
	opts   metav1.PatchOptions
	called bool
}

// The fake dynamic client drops PatchOptions from its recorded actions, so
// these wrappers capture them on the way through.
type capDyn struct {
	dynamic.Interface
	rec *capturedPatch
}

func (c capDyn) Resource(g schema.GroupVersionResource) dynamic.NamespaceableResourceInterface {
	return capNR{c.Interface.Resource(g), c.rec}
}

type capNR struct {
	dynamic.NamespaceableResourceInterface
	rec *capturedPatch
}

func (c capNR) Namespace(ns string) dynamic.ResourceInterface {
	return capR{c.NamespaceableResourceInterface.Namespace(ns), c.rec}
}

type capR struct {
	dynamic.ResourceInterface
	rec *capturedPatch
}

func (c capR) Patch(ctx context.Context, name string, pt types.PatchType, data []byte, opts metav1.PatchOptions, sub ...string) (*unstructured.Unstructured, error) {
	c.rec.opts = opts
	return c.ResourceInterface.Patch(ctx, name, pt, data, opts, sub...)
}

func editChannels(t *testing.T) (*Channels, *capturedPatch) {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	lg, err := audit.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lg.Close() })
	client := dynfake.NewSimpleDynamicClient(runtime.NewScheme())
	got := &capturedPatch{}
	client.PrependReactor("patch", "*", func(a k8stesting.Action) (bool, runtime.Object, error) {
		got.action = a.(k8stesting.PatchActionImpl)
		got.called = true
		u := &unstructured.Unstructured{}
		u.SetAPIVersion("apps/v1")
		u.SetKind("Deployment")
		u.SetName("debugging-apis-fml-in")
		u.SetNamespace("debug")
		return true, u, nil
	})
	c := &Channels{Audit: lg}
	c.dynOverride = func(context.Context, string) (dynamic.Interface, error) { return capDyn{client, got}, nil }
	return c, got
}

func putYAML(t *testing.T, c *Channels, body map[string]interface{}) (*httptest.ResponseRecorder, map[string]interface{}) {
	t.Helper()
	b, _ := json.Marshal(body)
	rr := httptest.NewRecorder()
	c.HandleApplyYAML(rr, httptest.NewRequest(http.MethodPut, "/api/yaml", bytes.NewReader(b)))
	var resp map[string]interface{}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return rr, resp
}

func editBody(original, modified string, dryRun bool) map[string]interface{} {
	return map[string]interface{}{
		"cluster": "c1", "gvr": "apps/v1/deployments", "ns": "debug", "name": "debugging-apis-fml-in",
		"yaml": modified, "original": original, "dryRun": dryRun, "force": false,
	}
}

func TestApplyYAMLEditSendsAnUpdatePatchNotServerSideApply(t *testing.T) {
	c, got := editChannels(t)
	edited := edit(deployYAML, "value: old-pwd", "value: s3cret-new")
	rr, resp := putYAML(t, c, editBody(deployYAML, edited, false))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	if !got.called {
		t.Fatal("no patch was sent")
	}
	if got.action.PatchType != types.StrategicMergePatchType {
		t.Errorf("patch type = %s, want strategic merge (an Update, which never conflicts with other field managers)", got.action.PatchType)
	}
	if got.opts.FieldManager != "kubebay" || got.opts.Force != nil {
		t.Errorf("options = %+v, want manager kubebay and no force", got.opts)
	}
	if resp["patchType"] != "strategic" {
		t.Errorf("response patchType = %v", resp["patchType"])
	}
	if paths, _ := resp["changedPaths"].([]interface{}); len(paths) != 1 {
		t.Errorf("changedPaths = %v, want the one edited env value", resp["changedPaths"])
	}
	entries, _ := c.Audit.Tail(5)
	if len(entries) == 0 {
		t.Fatal("no audit entry")
	}
	last := entries[len(entries)-1]
	if strings.Contains(last.Detail, "s3cret") || strings.Contains(last.Detail, "old-pwd") {
		t.Errorf("audit detail leaks a value: %s", last.Detail)
	}
	if !strings.Contains(last.Detail, "env[name=CONFIG_USER_PWD].value") {
		t.Errorf("audit detail should name the changed field: %s", last.Detail)
	}
}

func TestApplyYAMLEditDryRunPassesDryRun(t *testing.T) {
	c, got := editChannels(t)
	edited := edit(deployYAML, "value: eu-west-1", "value: us-east-1")
	rr, resp := putYAML(t, c, editBody(deployYAML, edited, true))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	if len(got.opts.DryRun) != 1 || got.opts.DryRun[0] != "All" {
		t.Errorf("dry run options = %v", got.opts.DryRun)
	}
	if resp["resultYaml"] == nil {
		t.Error("dry run should return the server's result YAML")
	}
}

func TestApplyYAMLEditWithNoChangesSendsNothing(t *testing.T) {
	c, got := editChannels(t)
	rr, resp := putYAML(t, c, editBody(deployYAML, deployYAML, false))
	if rr.Code != http.StatusOK || got.called {
		t.Fatalf("status = %d, patched = %v; want 200 and no patch", rr.Code, got.called)
	}
	if resp["noop"] != true {
		t.Errorf("response = %v, want noop", resp)
	}
}

func TestApplyYAMLEditRejectsRenames(t *testing.T) {
	c, got := editChannels(t)
	rr, _ := putYAML(t, c, editBody(deployYAML, edit(deployYAML, "name: debugging-apis-fml-in", "name: other"), false))
	if rr.Code != http.StatusBadRequest || got.called {
		t.Errorf("status = %d, patched = %v; want 400 and no patch", rr.Code, got.called)
	}
}

func TestApplyYAMLWithoutOriginalKeepsServerSideApply(t *testing.T) {
	c, got := editChannels(t)
	body := editBody("", deployYAML, false)
	delete(body, "original")
	rr, _ := putYAML(t, c, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	if got.action.PatchType != types.ApplyPatchType {
		t.Errorf("patch type = %s, want apply for callers that send no original", got.action.PatchType)
	}
}
