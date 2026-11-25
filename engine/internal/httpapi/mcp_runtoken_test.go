package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

type runSrc struct{}

func (runSrc) Clusters() []clusters.Cluster {
	return []clusters.Cluster{{ID: "kind-dev", Context: "kind-dev", Status: clusters.StatusReachable}, {ID: "prod", Context: "prod", Status: clusters.StatusReachable}}
}
func (runSrc) Snapshot(_ context.Context, _, gvr string, nss []string, _, _ string) ([]map[string]any, error) {
	return []map[string]any{{"metadata": map[string]any{"name": "web-1", "namespace": "shop"}, "status": map[string]any{"phase": "Running"}}}, nil
}

// runAPI builds an MCPAPI whose run handler is the real kubetools registry,
// read-only, over the scope the run token carries.
func runAPI(t *testing.T) *MCPAPI {
	t.Helper()
	a, _ := mcpFixture(t)
	a.RunHandlerFor = func(scope kubetools.Scope) http.Handler {
		reg := mcp.NewRegistryGated(func() bool { return false })
		kubetools.Register(reg, kubetools.Deps{Source: runSrc{}, Scope: func() kubetools.Scope { return scope }, Audit: func(audit.Entry) {}})
		return &mcp.Handler{Tools: reg, Name: "kubebay", Version: "test"}
	}
	return a
}

func rpc(t *testing.T, a *MCPAPI, token, body string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	a.Endpoint().ServeHTTP(rec, req)
	return rec
}

const listBody = `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`

func callBody(tool, args string) string {
	return `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"` + tool + `","arguments":` + args + `}}`
}

func TestRunTokenWorksWithTheUsersMCPSwitchOff(t *testing.T) {
	a := runAPI(t)
	tok, revoke, err := a.MintRunToken("kind-dev", "shop", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer revoke()
	rec := rpc(t, a, tok, listBody, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "list_resources") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	// Read-only: no proposal or write tool is listed.
	if strings.Contains(rec.Body.String(), "propose") {
		t.Fatalf("a write tool is listed: %s", rec.Body)
	}
	// The user's own endpoint stays off and their token path is untouched.
	if rec := mcpCall(t, a, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("user MCP must stay off: %d", rec.Code)
	}
}

func TestRunTokenRefusedAfterRevokeAndAfterExpiry(t *testing.T) {
	a := runAPI(t)
	tok, revoke, _ := a.MintRunToken("kind-dev", "", time.Minute)
	revoke()
	if rec := rpc(t, a, tok, listBody, nil); rec.Code != http.StatusForbidden && rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked token accepted: %d", rec.Code)
	}
	now := time.Now()
	a.now = func() time.Time { return now }
	tok2, _, _ := a.MintRunToken("kind-dev", "", time.Minute)
	a.now = func() time.Time { return now.Add(2 * time.Minute) }
	if rec := rpc(t, a, tok2, listBody, nil); rec.Code == http.StatusOK {
		t.Fatal("expired token accepted")
	}
}

func TestRunTokenRefusesBrowserOrigins(t *testing.T) {
	a := runAPI(t)
	tok, revoke, _ := a.MintRunToken("kind-dev", "", time.Minute)
	defer revoke()
	if rec := rpc(t, a, tok, listBody, map[string]string{"Origin": "http://evil.example"}); rec.Code != http.StatusForbidden {
		t.Fatalf("%d", rec.Code)
	}
}

func TestRunTokenIsBoundToOneClusterAndNamespace(t *testing.T) {
	a := runAPI(t)
	tok, revoke, _ := a.MintRunToken("kind-dev", "shop", time.Minute)
	defer revoke()
	ok := rpc(t, a, tok, callBody("list_resources", `{"cluster":"kind-dev","kind":"pods","namespace":"shop"}`), nil)
	if !strings.Contains(ok.Body.String(), "web-1") {
		t.Fatalf("in-scope read failed: %s", ok.Body)
	}
	for name, args := range map[string]string{
		"other cluster":   `{"cluster":"prod","kind":"pods"}`,
		"other namespace": `{"cluster":"kind-dev","kind":"pods","namespace":"kube-system"}`,
	} {
		rec := rpc(t, a, tok, callBody("list_resources", args), nil)
		if strings.Contains(rec.Body.String(), "web-1") || !strings.Contains(rec.Body.String(), "isError") {
			t.Errorf("%s was served: %s", name, rec.Body)
		}
	}
}

func TestRunTokenCannotReadSecretsOrWrite(t *testing.T) {
	a := runAPI(t)
	tok, revoke, _ := a.MintRunToken("kind-dev", "shop", time.Minute)
	defer revoke()
	for _, c := range []struct{ tool, args string }{
		{"list_resources", `{"cluster":"kind-dev","kind":"secrets","namespace":"shop"}`},
		{"get_manifest", `{"cluster":"kind-dev","kind":"secrets","namespace":"shop","name":"x"}`},
		{"describe_resource", `{"cluster":"kind-dev","kind":"secrets","namespace":"shop","name":"x"}`},
		{"propose_change", `{"cluster":"kind-dev","kind":"deployments","namespace":"shop","name":"x","patch":{},"reason":"x"}`},
	} {
		rec := rpc(t, a, tok, callBody(c.tool, c.args), nil)
		var out struct {
			Result struct {
				IsError bool `json:"isError"`
			} `json:"result"`
			Error *json.RawMessage `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if !out.Result.IsError && out.Error == nil {
			t.Errorf("%s on a secret/write was not refused: %s", c.tool, rec.Body)
		}
	}
}

func TestRunTokenScopeIsIntersectedWithTheUsersMCPScope(t *testing.T) {
	a := runAPI(t)
	if rec := mcpSave(t, a, `{"enabled":true,"clusters":{"kind-dev":["shop"]}}`); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	if _, _, err := a.MintRunToken("prod", "shop", time.Minute); err == nil {
		t.Fatal("a cluster the user kept away from assistants must be refused")
	}
	if _, _, err := a.MintRunToken("kind-dev", "ops", time.Minute); err == nil {
		t.Fatal("a namespace outside the user's scope must be refused")
	}
	tok, revoke, err := a.MintRunToken("kind-dev", "shop", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	revoke()
	_ = tok
	// No namespace given (a node issue): the user's namespace list narrows it.
	tok, revoke, err = a.MintRunToken("kind-dev", "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer revoke()
	rec := rpc(t, a, tok, callBody("list_resources", `{"cluster":"kind-dev","kind":"pods","namespace":"ops"}`), nil)
	if strings.Contains(rec.Body.String(), "web-1") {
		t.Fatalf("namespace outside the user's scope served: %s", rec.Body)
	}
}

func TestMintRunTokenNeedsARunHandlerAndAnEnabledEndpoint(t *testing.T) {
	a, _ := mcpFixture(t)
	if _, _, err := a.MintRunToken("kind-dev", "", time.Minute); err == nil {
		t.Fatal("no run handler configured must fail")
	}
	b := NewMCPAPI(settingsWithManager(t), "http://127.0.0.1:1/mcp", "off here")
	b.RunHandlerFor = func(kubetools.Scope) http.Handler { return nil }
	if _, _, err := b.MintRunToken("kind-dev", "", time.Minute); err == nil {
		t.Fatal("a disabled endpoint must not mint")
	}
}
