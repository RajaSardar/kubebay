package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
)

// MCP phase 2 against a live cluster (backlog #5): an assistant proposes a
// change, nothing happens, the person approves it in Kubebay, and only then
// does it apply, as field manager kubebay-mcp. The Deployment controller
// writes status in between, which must not block the approval; a proposal
// for an object whose spec or metadata changed after review is refused.
func TestLiveMCPProposalAppliesOnlyAfterApproval(t *testing.T) {
	if os.Getenv("KUBEBAY_INTEGRATION_TEST") != "1" {
		t.Skip("set KUBEBAY_INTEGRATION_TEST=1 against a reachable API server")
	}
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(safeKubeconfigRules(t), &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		t.Skipf("no kubeconfig: %v", err)
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	name := fmt.Sprintf("kb-propose-%d", time.Now().UnixNano())
	zero := int32(0)
	labels := map[string]string{"app": name}
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Replicas: &zero,
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "pause", Image: "registry.k8s.io/pause:3.9"}}},
			},
		},
	}
	if _, err := cs.AppsV1().Deployments("default").Create(ctx, dep, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cs.AppsV1().Deployments("default").Delete(context.Background(), name, metav1.DeleteOptions{}) })

	kc := os.Getenv("KUBEBAY_KUBECONFIG")
	if kc == "" {
		kc = os.Getenv("KUBECONFIG")
	}
	t.Setenv("HOME", t.TempDir())
	log := testLogger(t)
	mgr, err := clusters.NewManager(log, kc)
	if err != nil {
		t.Fatal(err)
	}
	auditLog, err := audit.New(log)
	if err != nil {
		t.Fatal(err)
	}
	defer auditLog.Close()
	var clusterID string
	for _, c := range mgr.List() {
		clusterID = c.ID
		break
	}
	src := kubetools.PoolSource{Pools: informers.NewPoolRegistry(mgr), Manager: mgr}
	api := httpapi.NewMCPAPI(httpapi.NewSettingsManager(mgr), "http://127.0.0.1/mcp", "")
	api.Proposals = proposals.New(src, auditLog.Record)
	reg := mcp.NewRegistry()
	kubetools.Register(reg, kubetools.Deps{Source: src, Scope: api.Scope, Audit: auditLog.Record, Proposals: api.Proposals, Writes: api.Writes})
	api.Handler = &mcp.Handler{Tools: reg, Name: "kubebay", Version: "it"}
	srv := httptest.NewServer(httpapi.Router(httpapi.Deps{Clusters: mgr, MCP: api}, "ui-token"))
	t.Cleanup(srv.Close)

	ui := func(method, path, body string) *http.Response {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		req.Header.Set("X-Kubebay-Token", "ui-token")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	if res := ui(http.MethodPost, "/api/mcp", `{"enabled":true,"writesEnabled":true,"clusters":{"`+clusterID+`":["default"]}}`); res.StatusCode != http.StatusOK {
		t.Fatalf("enable: %d", res.StatusCode)
	}
	home, _ := os.UserHomeDir()
	b, _ := os.ReadFile(filepath.Join(home, ".kubebay", "mcp.json"))
	var conn struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(b, &conn)

	propose := func(seconds int) string {
		body, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0", "id": 1, "method": "tools/call",
			"params": map[string]any{
				"_meta": map[string]any{"io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": map[string]string{"name": "it", "version": "1"}},
				"name":  "propose_change",
				"arguments": map[string]any{
					"cluster": clusterID, "kind": "deployments", "namespace": "default", "name": name,
					"patch": map[string]any{"spec": map[string]any{"minReadySeconds": seconds}}, "reason": "integration test",
				},
			},
		})
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/mcp", strings.NewReader(string(body)))
		req.Header.Set("Authorization", "Bearer "+conn.Token)
		req.Header.Set("MCP-Protocol-Version", "2026-07-28")
		req.Header.Set("Mcp-Method", "tools/call")
		req.Header.Set("Mcp-Name", "propose_change")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out struct {
			Result struct {
				Content []struct {
					Text string `json:"text"`
				} `json:"content"`
				IsError bool `json:"isError"`
			} `json:"result"`
		}
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil || out.Result.IsError || len(out.Result.Content) == 0 {
			t.Fatalf("propose: %v %+v", err, out)
		}
		var p struct {
			ProposalID string `json:"proposalId"`
		}
		_ = json.Unmarshal([]byte(out.Result.Content[0].Text), &p)
		return p.ProposalID
	}
	minReady := func() int32 {
		d, err := cs.AppsV1().Deployments("default").Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			t.Fatal(err)
		}
		return d.Spec.MinReadySeconds
	}

	id := propose(5)
	if minReady() != 0 {
		t.Fatal("proposing changed the Deployment")
	}
	if res := ui(http.MethodPost, "/api/mcp/proposals/"+id+"/approve", ""); res.StatusCode != http.StatusOK {
		t.Fatalf("approve: %d", res.StatusCode)
	}
	if minReady() != 5 {
		t.Error("approval didn't apply the change")
	}
	d, _ := cs.AppsV1().Deployments("default").Get(ctx, name, metav1.GetOptions{})
	managed := false
	for _, f := range d.ManagedFields {
		managed = managed || f.Manager == "kubebay-mcp"
	}
	if !managed {
		t.Error("the change should belong to field manager kubebay-mcp")
	}

	// Someone else changes the object after the proposal: approving it
	// would apply a diff nobody reviewed.
	stale := propose(7)
	if _, err := cs.AppsV1().Deployments("default").Patch(ctx, name, types.MergePatchType, []byte(`{"metadata":{"labels":{"touched":"yes"}}}`), metav1.PatchOptions{}); err != nil {
		t.Fatal(err)
	}
	if res := ui(http.MethodPost, "/api/mcp/proposals/"+stale+"/approve", ""); res.StatusCode != http.StatusConflict {
		t.Errorf("stale approve: %d", res.StatusCode)
	}
	if minReady() != 5 {
		t.Error("a stale proposal must not apply")
	}
}
