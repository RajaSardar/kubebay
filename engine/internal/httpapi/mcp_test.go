package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/mcp"
)

func mcpFixture(t *testing.T) (*MCPAPI, *SettingsManager) {
	t.Helper()
	sm := settingsWithManager(t)
	reg := mcp.NewRegistry()
	reg.Add(mcp.Tool{Name: "ping_tool", Description: "test", InputSchema: json.RawMessage(`{"type":"object"}`),
		Handler: func(context.Context, json.RawMessage, mcp.CallInfo) (mcp.Result, error) {
			return mcp.TextResult("pong"), nil
		}})
	a := NewMCPAPI(sm, "http://127.0.0.1:9898/mcp", "")
	a.Handler = &mcp.Handler{Tools: reg, Name: "kubebay", Version: "test"}
	return a, sm
}

func mcpCall(t *testing.T, a *MCPAPI, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	a.Endpoint().ServeHTTP(rec, req)
	return rec
}

func mcpSave(t *testing.T, a *MCPAPI, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	a.HandleSave(rec, httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(body)))
	return rec
}

type connFile struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func readConn(t *testing.T) (connFile, os.FileInfo) {
	t.Helper()
	home, _ := os.UserHomeDir()
	p := filepath.Join(home, ".kubebay", "mcp.json")
	st, err := os.Stat(p)
	if err != nil {
		return connFile{}, nil
	}
	b, _ := os.ReadFile(p)
	var c connFile
	_ = json.Unmarshal(b, &c)
	return c, st
}

func TestMCPIsOffUntilTheUserTurnsItOn(t *testing.T) {
	a, _ := mcpFixture(t)
	if rec := mcpCall(t, a, nil); rec.Code != http.StatusForbidden {
		t.Errorf("default: %d, want 403", rec.Code)
	}
	if c, _ := readConn(t); c.Token != "" {
		t.Error("no token exists before MCP is turned on")
	}
}

func TestEnablingMintsASeparateTokenInA0600File(t *testing.T) {
	a, _ := mcpFixture(t)
	if rec := mcpSave(t, a, `{"enabled":true,"clusters":{"kind-dev":[]}}`); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	c, st := readConn(t)
	if c.Token == "" || len(c.Token) < 32 || c.URL != "http://127.0.0.1:9898/mcp" {
		t.Fatalf("connection file = %+v", c)
	}
	if st.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v", st.Mode().Perm())
	}
	if rec := mcpCall(t, a, map[string]string{"Authorization": "Bearer " + c.Token}); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ping_tool") {
		t.Errorf("with the MCP token: %d %s", rec.Code, rec.Body)
	}
	for name, h := range map[string]map[string]string{
		"no token":     nil,
		"wrong token":  {"Authorization": "Bearer nope"},
		"the UI token": {"X-Kubebay-Token": c.Token},
		"basic scheme": {"Authorization": "Basic " + c.Token},
	} {
		if rec := mcpCall(t, a, h); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: %d, want 401", name, rec.Code)
		}
	}
	// No MCP client is a browser: any Origin is a page trying its luck.
	if rec := mcpCall(t, a, map[string]string{"Authorization": "Bearer " + c.Token, "Origin": "http://127.0.0.1:9898"}); rec.Code != http.StatusForbidden {
		t.Errorf("with an Origin: %d, want 403", rec.Code)
	}
	if got := a.Scope().Clusters; len(got) != 1 {
		t.Errorf("scope = %v", got)
	}
}

func TestRotatingAndDisablingRevokeTheToken(t *testing.T) {
	a, _ := mcpFixture(t)
	mcpSave(t, a, `{"enabled":true,"clusters":{"kind-dev":[]}}`)
	old, _ := readConn(t)
	rec := httptest.NewRecorder()
	a.HandleRotate(rec, httptest.NewRequest(http.MethodPost, "/api/mcp/rotate", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("rotate: %d %s", rec.Code, rec.Body)
	}
	cur, _ := readConn(t)
	if cur.Token == old.Token {
		t.Fatal("rotate kept the token")
	}
	if rec := mcpCall(t, a, map[string]string{"Authorization": "Bearer " + old.Token}); rec.Code != http.StatusUnauthorized {
		t.Errorf("old token after rotate: %d", rec.Code)
	}
	mcpSave(t, a, `{"enabled":false,"clusters":{"kind-dev":[]}}`)
	if rec := mcpCall(t, a, map[string]string{"Authorization": "Bearer " + cur.Token}); rec.Code != http.StatusForbidden {
		t.Errorf("after disabling: %d, want 403", rec.Code)
	}
	if c, st := readConn(t); st != nil || c.Token != "" {
		t.Error("disabling deletes the connection file")
	}
}

func TestMCPScopeSurvivesTheSettingsPageSaving(t *testing.T) {
	a, sm := mcpFixture(t)
	mcpSave(t, a, `{"enabled":true,"clusters":{"kind-dev":["shop"]}}`)
	save(t, sm, `{"prometheusUrl":"http://127.0.0.1:9090"}`)
	set, _ := sm.Load()
	if set.MCP == nil || !set.MCP.Enabled || len(set.MCP.Clusters["kind-dev"]) != 1 {
		t.Errorf("settings save dropped MCP: %+v", set.MCP)
	}
	// A restarted engine picks the token and scope back up.
	b := NewMCPAPI(sm, "http://127.0.0.1:9898/mcp", "")
	b.Handler = a.Handler
	c, _ := readConn(t)
	if rec := mcpCall(t, b, map[string]string{"Authorization": "Bearer " + c.Token}); rec.Code != http.StatusOK {
		t.Errorf("after restart: %d %s", rec.Code, rec.Body)
	}
}

func TestMCPRejectsBadScope(t *testing.T) {
	a, _ := mcpFixture(t)
	for _, body := range []string{`{"enabled":true,"clusters":{"kind-dev":["Not A Namespace"]}}`, `{"enabled":true,"clusters":{"":[]}}`} {
		if rec := mcpSave(t, a, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
}

func TestMCPGetDescribesTheConnectionWithoutTheToken(t *testing.T) {
	a, _ := mcpFixture(t)
	mcpSave(t, a, `{"enabled":true,"clusters":{"kind-dev":[]}}`)
	rec := httptest.NewRecorder()
	a.HandleGet(rec, httptest.NewRequest(http.MethodGet, "/api/mcp", nil))
	c, _ := readConn(t)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), c.Token) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var got struct {
		Enabled        bool   `json:"enabled"`
		URL            string `json:"url"`
		ConnectionFile string `json:"connectionFile"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if !got.Enabled || got.URL == "" || !strings.HasSuffix(got.ConnectionFile, "mcp.json") {
		t.Errorf("get = %s", rec.Body)
	}
}

// One engine shared by several logged-in users, or reachable off the
// machine, would hand every token holder the engine's own view.
func TestMCPIsDesktopOnly(t *testing.T) {
	sm := settingsWithManager(t)
	a := NewMCPAPI(sm, "", MCPBlockReason(false, true, true))
	a.Handler = &mcp.Handler{Tools: mcp.NewRegistry(), Name: "kubebay"}
	if rec := mcpCall(t, a, nil); rec.Code != http.StatusNotFound {
		t.Errorf("blocked endpoint: %d, want 404", rec.Code)
	}
	if rec := mcpSave(t, a, `{"enabled":true,"clusters":{"kind-dev":[]}}`); rec.Code != http.StatusForbidden {
		t.Errorf("blocked save: %d", rec.Code)
	}
	if MCPBlockReason(true, false, true) == "" || MCPBlockReason(false, false, false) == "" || MCPBlockReason(false, false, true) != "" {
		t.Error("blocked in-cluster, with OIDC, or off loopback")
	}
}

// /mcp sits outside the UI's token group: it needs its own token and nothing
// else, while the settings that control it need the UI's.
func TestMCPRoutesUseSeparateCredentials(t *testing.T) {
	a, _ := mcpFixture(t)
	mcpSave(t, a, `{"enabled":true,"clusters":{"kind-dev":[]}}`)
	c, _ := readConn(t)
	h := Router(Deps{MCP: a}, "ui-secret")

	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`))
	req.Header.Set("Authorization", "Bearer "+c.Token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("/mcp with only the MCP token: %d %s", rec.Code, rec.Body)
	}

	req = httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{}`))
	req.Header.Set("X-Kubebay-Token", "ui-secret")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("/mcp with the UI token: %d, want 401", rec.Code)
	}

	for _, rt := range []struct{ method, path string }{{http.MethodGet, "/api/mcp"}, {http.MethodPost, "/api/mcp"}, {http.MethodPost, "/api/mcp/rotate"}} {
		req = httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+c.Token)
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s with the MCP token: %d, want 401", rt.method, rt.path, rec.Code)
		}
	}
}
