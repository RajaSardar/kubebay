package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

// Incident triage's preview against a live cluster (backlog #13): turn it on
// for one cluster and assemble a coredns pod's evidence bundle, the exact
// request a Send would make. Nothing is sent.
func TestLiveTriagePreviewAssemblesCoreDNSEvidence(t *testing.T) {
	if os.Getenv("KUBEBAY_INTEGRATION_TEST") != "1" {
		t.Skip("set KUBEBAY_INTEGRATION_TEST=1 against a reachable API server")
	}
	kc := os.Getenv("KUBEBAY_KUBECONFIG")
	if kc == "" {
		kc = os.Getenv("KUBECONFIG")
	}
	t.Setenv("HOME", t.TempDir())
	log := testLogger(t)
	mgr, err := clusters.NewManager(log, kc)
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	pools := informers.NewPoolRegistry(mgr)
	auditLog, err := audit.New(log)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	defer auditLog.Close()
	var clusterID string
	for _, c := range mgr.List() {
		clusterID = c.ID
		break
	}
	src := kubetools.PoolSource{Pools: pools, Manager: mgr}

	pods, err := src.Snapshot(context.Background(), clusterID, "v1/pods", []string{"kube-system"}, "k8s-app=kube-dns", "full")
	if err != nil || len(pods) == 0 {
		t.Fatalf("coredns pods: %v (%d)", err, len(pods))
	}
	podName, _ := pods[0]["metadata"].(map[string]any)["name"].(string)

	api := &httpapi.TriageAPI{
		Settings: httpapi.NewSettingsManager(mgr),
		Getenv:   func(string) string { return "" },
		Audit:    auditLog.Record,
		Evidence: func(ctx context.Context, cluster, ns, pod string) (kubetools.Evidence, error) {
			return kubetools.BuildEvidence(ctx, src, cluster, ns, pod, 0)
		},
	}
	srv := httptest.NewServer(httpapi.Router(httpapi.Deps{Clusters: mgr, Triage: api}, "ui-token"))
	t.Cleanup(srv.Close)
	post := func(path, body string) *http.Response {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(body))
		req.Header.Set("X-Kubebay-Token", "ui-token")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	if res := post("/api/triage", `{"enabled":true,"clusters":["`+clusterID+`"]}`); res.StatusCode != http.StatusOK {
		t.Fatalf("enable: %d", res.StatusCode)
	}
	res := post("/api/triage/preview", `{"cluster":"`+clusterID+`","namespace":"kube-system","pod":"`+podName+`"}`)
	defer res.Body.Close()
	var got struct {
		Request struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		} `json:"request"`
	}
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil || res.StatusCode != http.StatusOK || len(got.Request.Messages) != 1 {
		t.Fatalf("preview: %d %v", res.StatusCode, err)
	}
	c := got.Request.Messages[0].Content
	for _, want := range []string{"[E1] Pod kube-system/" + podName, "Deployment/coredns", "Rollout history of Deployment coredns", "Logs of coredns (current)"} {
		if !strings.Contains(c, want) {
			t.Errorf("bundle should carry %q:\n%s", want, c)
		}
	}
}
