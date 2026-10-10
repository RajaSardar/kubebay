package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

// The MCP server end to end against a live cluster (backlog #5): turn it on
// for one cluster, then list kube-system pods through /mcp with the MCP token,
// served from the engine's informer pool.
func TestLiveMCPListsPodsFromTheInformerCache(t *testing.T) {
	if os.Getenv("KUBEBAY_INTEGRATION_TEST") != "1" {
		t.Skip("set KUBEBAY_INTEGRATION_TEST=1 against a reachable API server")
	}
	kc := os.Getenv("KUBEBAY_KUBECONFIG")
	if kc == "" {
		kc = os.Getenv("KUBECONFIG")
	}
	// Settings and the MCP connection file go to a throwaway HOME.
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
	if clusterID == "" {
		t.Fatal("no cluster in the kubeconfig")
	}

	sm := httpapi.NewSettingsManager(mgr)
	api := httpapi.NewMCPAPI(sm, "http://127.0.0.1/mcp", "")
	reg := mcp.NewRegistry()
	kubetools.Register(reg, kubetools.Deps{Source: kubetools.PoolSource{Pools: pools, Manager: mgr}, Scope: api.Scope, Audit: auditLog.Record})
	api.Handler = &mcp.Handler{Tools: reg, Name: "kubebay", Version: "it"}
	srv := httptest.NewServer(httpapi.Router(httpapi.Deps{Clusters: mgr, MCP: api}, "ui-token"))
	t.Cleanup(srv.Close)

	enable, _ := json.Marshal(map[string]any{"enabled": true, "clusters": map[string][]string{clusterID: {}}})
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/mcp", strings.NewReader(string(enable)))
	req.Header.Set("X-Kubebay-Token", "ui-token")
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("enable MCP: %v %v", err, res)
	}
	res.Body.Close()
	home, _ := os.UserHomeDir()
	b, err := os.ReadFile(filepath.Join(home, ".kubebay", "mcp.json"))
	if err != nil {
		t.Fatal(err)
	}
	var conn struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(b, &conn)

	call := func(name string, args map[string]any) string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0", "id": 1, "method": "tools/call",
			"params": map[string]any{
				"_meta":     map[string]any{"io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": map[string]string{"name": "it", "version": "1"}},
				"name":      name,
				"arguments": args,
			},
		})
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/mcp", strings.NewReader(string(body)))
		req.Header.Set("Authorization", "Bearer "+conn.Token)
		req.Header.Set("MCP-Protocol-Version", "2026-07-28")
		req.Header.Set("Mcp-Method", "tools/call")
		req.Header.Set("Mcp-Name", name)
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
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil || res.StatusCode != http.StatusOK {
			t.Fatalf("%s: %d %v", name, res.StatusCode, err)
		}
		if out.Result.IsError || len(out.Result.Content) == 0 {
			t.Fatalf("%s: tool error: %+v", name, out.Result)
		}
		return out.Result.Content[0].Text
	}

	text := call("list_resources", map[string]any{"cluster": clusterID, "kind": "pods", "namespace": "kube-system"})
	if !strings.Contains(text, `"kind":"pods"`) || !strings.Contains(text, "coredns") {
		t.Errorf("kube-system pods: %s", text)
	}
	var list struct {
		Rows []struct {
			Name string `json:"name"`
		} `json:"rows"`
	}
	_ = json.Unmarshal([]byte(text), &list)
	coredns := ""
	for _, r := range list.Rows {
		if strings.HasPrefix(r.Name, "coredns") {
			coredns = r.Name
			break
		}
	}
	if coredns == "" {
		t.Fatalf("no coredns pod in %s", text)
	}
	if d := call("describe_resource", map[string]any{"cluster": clusterID, "kind": "pods", "namespace": "kube-system", "name": coredns}); !strings.Contains(d, "coredns") || !strings.Contains(d, `"owners":["ReplicaSet/`) || !strings.Contains(d, "Deployment/coredns") {
		t.Errorf("describe coredns: %s", d)
	}
	if l := call("get_logs", map[string]any{"cluster": clusterID, "namespace": "kube-system", "pod": coredns}); !strings.Contains(l, "logs of kube-system/"+coredns) {
		t.Errorf("logs: %s", l)
	}
	if h := call("get_cluster_health", map[string]any{"cluster": clusterID}); !strings.Contains(h, `"nodesReady":`) || !strings.Contains(h, `"podsTotal":`) {
		t.Errorf("health: %s", h)
	}
	if m := call("get_manifest", map[string]any{"cluster": clusterID, "kind": "deployments", "namespace": "kube-system", "name": "coredns"}); !strings.Contains(m, "kind: Deployment") || strings.Contains(m, "managedFields") {
		t.Errorf("manifest: %s", m)
	}
	if strings.Contains(text, `"spec"`) {
		t.Error("rows, never whole objects")
	}
}
