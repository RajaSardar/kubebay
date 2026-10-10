package mcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func echoServer(t *testing.T) (*Handler, *[]CallInfo) {
	t.Helper()
	var calls []CallInfo
	reg := NewRegistry()
	reg.Add(Tool{
		Name:        "echo",
		Title:       "Echo",
		Description: "Echoes its text argument.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}`),
		Handler: func(_ context.Context, args json.RawMessage, call CallInfo) (Result, error) {
			calls = append(calls, call)
			var a struct {
				Text string `json:"text"`
			}
			if err := json.Unmarshal(args, &a); err != nil || a.Text == "" {
				return Result{}, ArgError("text is required")
			}
			if a.Text == "boom" {
				return Result{}, errors.New("cluster unreachable")
			}
			return TextResult("echo: " + a.Text), nil
		},
	})
	reg.Add(Tool{Name: "alpha", Description: "Listed first.", InputSchema: json.RawMessage(`{"type":"object"}`),
		Handler: func(context.Context, json.RawMessage, CallInfo) (Result, error) { return TextResult("a"), nil }})
	return &Handler{Tools: reg, Name: "kubebay", Version: "test"}, &calls
}

type exchange struct {
	method  string
	headers map[string]string
	body    string
}

func do(t *testing.T, h http.Handler, ex exchange) (int, map[string]any, http.Header) {
	t.Helper()
	if ex.method == "" {
		ex.method = http.MethodPost
	}
	req := httptest.NewRequest(ex.method, "/mcp", strings.NewReader(ex.body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range ex.headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("response is not one JSON object: %v\n%s", err, rec.Body)
		}
	}
	return rec.Code, out, rec.Header()
}

const modern = "2026-07-28"

func modernHeaders(method, name string) map[string]string {
	h := map[string]string{"MCP-Protocol-Version": modern, "Mcp-Method": method}
	if name != "" {
		h["Mcp-Name"] = name
	}
	return h
}

func modernBody(id int, method, params string) string {
	meta := `"_meta":{"io.modelcontextprotocol/protocolVersion":"` + modern + `","io.modelcontextprotocol/clientInfo":{"name":"test-client","version":"1.2"},"io.modelcontextprotocol/clientCapabilities":{}}`
	if params == "" {
		params = "{" + meta + "}"
	} else {
		params = "{" + meta + "," + params + "}"
	}
	b, _ := json.Marshal(id)
	return `{"jsonrpc":"2.0","id":` + string(b) + `,"method":"` + method + `","params":` + params + `}`
}

func result(t *testing.T, out map[string]any) map[string]any {
	t.Helper()
	r, ok := out["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result: %v", out)
	}
	return r
}

func errCode(out map[string]any) float64 {
	e, _ := out["error"].(map[string]any)
	c, _ := e["code"].(float64)
	return c
}

// --- 2026-07-28: stateless, per-request _meta ---

func TestDiscoverAdvertisesVersionsCapabilitiesAndIdentity(t *testing.T) {
	h, _ := echoServer(t)
	code, out, hdr := do(t, h, exchange{headers: modernHeaders("server/discover", ""), body: modernBody(1, "server/discover", "")})
	if code != 200 || !strings.HasPrefix(hdr.Get("Content-Type"), "application/json") {
		t.Fatalf("%d %v", code, hdr)
	}
	r := result(t, out)
	if r["resultType"] != "complete" {
		t.Errorf("resultType = %v", r["resultType"])
	}
	versions, _ := r["supportedVersions"].([]any)
	if len(versions) == 0 || versions[0] != modern {
		t.Errorf("supportedVersions = %v", versions)
	}
	if _, ok := r["capabilities"].(map[string]any)["tools"]; !ok {
		t.Errorf("capabilities = %v", r["capabilities"])
	}
	info := r["_meta"].(map[string]any)["io.modelcontextprotocol/serverInfo"].(map[string]any)
	if info["name"] != "kubebay" {
		t.Errorf("serverInfo = %v", info)
	}
}

func TestToolsListIsDeterministicCacheableAndReadOnly(t *testing.T) {
	h, _ := echoServer(t)
	_, out, _ := do(t, h, exchange{headers: modernHeaders("tools/list", ""), body: modernBody(2, "tools/list", "")})
	r := result(t, out)
	tools := r["tools"].([]any)
	if len(tools) != 2 || tools[0].(map[string]any)["name"] != "alpha" || tools[1].(map[string]any)["name"] != "echo" {
		t.Fatalf("tools = %v", tools)
	}
	ann := tools[1].(map[string]any)["annotations"].(map[string]any)
	if ann["readOnlyHint"] != true {
		t.Errorf("annotations = %v", ann)
	}
	if r["resultType"] != "complete" || r["ttlMs"] == nil || r["cacheScope"] != "private" {
		t.Errorf("cacheable fields: %v", r)
	}
}

func TestToolsCallRunsTheToolWithTheClientIdentity(t *testing.T) {
	h, calls := echoServer(t)
	code, out, _ := do(t, h, exchange{
		headers: modernHeaders("tools/call", "echo"),
		body:    modernBody(3, "tools/call", `"name":"echo","arguments":{"text":"hi"}`),
	})
	if code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	r := result(t, out)
	content := r["content"].([]any)[0].(map[string]any)
	if content["type"] != "text" || content["text"] != "echo: hi" || r["isError"] == true {
		t.Errorf("result = %v", r)
	}
	if len(*calls) != 1 || (*calls)[0].ClientName != "test-client" || (*calls)[0].ClientVersion != "1.2" || (*calls)[0].RequestID != "3" {
		t.Errorf("call info = %+v", *calls)
	}
}

// Argument and tool failures come back as a tool result with isError, so the
// model sees them, not as a protocol error.
func TestToolErrorsAreToolResults(t *testing.T) {
	h, _ := echoServer(t)
	for _, args := range []string{`{}`, `{"text":"boom"}`} {
		code, out, _ := do(t, h, exchange{headers: modernHeaders("tools/call", "echo"), body: modernBody(4, "tools/call", `"name":"echo","arguments":`+args)})
		r := result(t, out)
		if code != 200 || r["isError"] != true {
			t.Errorf("%s: %d %v", args, code, out)
		}
	}
	code, out, _ := do(t, h, exchange{headers: modernHeaders("tools/call", "nope"), body: modernBody(5, "tools/call", `"name":"nope","arguments":{}`)})
	if code != 200 || result(t, out)["isError"] != true {
		t.Errorf("unknown tool: %d %v", code, out)
	}
}

func TestModernHeadersMustMatchTheBody(t *testing.T) {
	h, _ := echoServer(t)
	cases := map[string]map[string]string{
		"missing version header": {"Mcp-Method": "tools/list"},
		"version mismatch":       {"MCP-Protocol-Version": "2025-11-25", "Mcp-Method": "tools/list"},
		"method mismatch":        {"MCP-Protocol-Version": modern, "Mcp-Method": "tools/call"},
		"missing method header":  {"MCP-Protocol-Version": modern},
	}
	for name, hdr := range cases {
		code, out, _ := do(t, h, exchange{headers: hdr, body: modernBody(6, "tools/list", "")})
		if code != 400 || errCode(out) != -32020 {
			t.Errorf("%s: %d %v", name, code, out)
		}
	}
	code, out, _ := do(t, h, exchange{headers: modernHeaders("tools/call", "alpha"), body: modernBody(7, "tools/call", `"name":"echo","arguments":{"text":"x"}`)})
	if code != 400 || errCode(out) != -32020 {
		t.Errorf("Mcp-Name mismatch: %d %v", code, out)
	}
	enc := "=?base64?" + base64.StdEncoding.EncodeToString([]byte("echo")) + "?="
	code, out, _ = do(t, h, exchange{headers: modernHeaders("tools/call", enc), body: modernBody(8, "tools/call", `"name":"echo","arguments":{"text":"x"}`)})
	if code != 200 {
		t.Errorf("base64 Mcp-Name: %d %v", code, out)
	}
}

func TestAnUnsupportedVersionListsTheSupportedOnes(t *testing.T) {
	h, _ := echoServer(t)
	body := strings.ReplaceAll(modernBody(9, "tools/list", ""), modern, "2099-01-01")
	code, out, _ := do(t, h, exchange{headers: map[string]string{"MCP-Protocol-Version": "2099-01-01", "Mcp-Method": "tools/list"}, body: body})
	if code != 400 || errCode(out) != -32022 {
		t.Fatalf("%d %v", code, out)
	}
	data := out["error"].(map[string]any)["data"].(map[string]any)
	if s, _ := data["supported"].([]any); len(s) == 0 {
		t.Errorf("data = %v", data)
	}
}

func TestUnknownModernMethodIs404(t *testing.T) {
	h, _ := echoServer(t)
	code, out, _ := do(t, h, exchange{headers: modernHeaders("resources/list", ""), body: modernBody(10, "resources/list", "")})
	if code != 404 || errCode(out) != -32601 {
		t.Errorf("%d %v", code, out)
	}
}

// --- 2025-03-26 … 2025-11-25: initialize handshake ---

func legacy(id int, method, params string) string {
	if params == "" {
		params = "{}"
	}
	return `{"jsonrpc":"2.0","id":` + strings.TrimSpace(func() string { b, _ := json.Marshal(id); return string(b) }()) + `,"method":"` + method + `","params":` + params + `}`
}

func TestLegacyInitializeNegotiatesTheVersion(t *testing.T) {
	h, _ := echoServer(t)
	code, out, hdr := do(t, h, exchange{body: legacy(1, "initialize", `{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"old","version":"0.9"}}`)})
	if code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	r := result(t, out)
	if r["protocolVersion"] != "2025-06-18" || r["serverInfo"].(map[string]any)["name"] != "kubebay" {
		t.Errorf("initialize = %v", r)
	}
	if _, ok := r["capabilities"].(map[string]any)["tools"]; !ok {
		t.Errorf("capabilities = %v", r)
	}
	if hdr.Get("Mcp-Session-Id") != "" {
		t.Error("the server is stateless and never mints a session")
	}
	_, out, _ = do(t, h, exchange{body: legacy(2, "initialize", `{"protocolVersion":"2024-01-01","capabilities":{},"clientInfo":{"name":"older","version":"0"}}`)})
	if result(t, out)["protocolVersion"] != "2025-11-25" {
		t.Errorf("an unknown version gets our latest legacy one: %v", out)
	}
}

func TestLegacyPingListAndCall(t *testing.T) {
	h, calls := echoServer(t)
	hdr := map[string]string{"MCP-Protocol-Version": "2025-11-25"}
	if code, out, _ := do(t, h, exchange{headers: hdr, body: legacy(3, "ping", "")}); code != 200 || len(result(t, out)) != 0 {
		t.Errorf("ping: %d %v", code, out)
	}
	if _, out, _ := do(t, h, exchange{headers: hdr, body: legacy(4, "tools/list", "")}); len(result(t, out)["tools"].([]any)) != 2 {
		t.Errorf("tools/list: %v", out)
	}
	_, out, _ := do(t, h, exchange{headers: hdr, body: legacy(5, "tools/call", `{"name":"echo","arguments":{"text":"yo"}}`)})
	if result(t, out)["content"].([]any)[0].(map[string]any)["text"] != "echo: yo" {
		t.Errorf("tools/call: %v", out)
	}
	if len(*calls) != 1 || (*calls)[0].RequestID != "5" {
		t.Errorf("calls: %+v", *calls)
	}
	if code, _, _ := do(t, h, exchange{headers: map[string]string{"MCP-Protocol-Version": "1999-01-01"}, body: legacy(6, "tools/list", "")}); code != 400 {
		t.Errorf("unsupported legacy version header: %d", code)
	}
}

func TestNotificationsGet202WithNoBody(t *testing.T) {
	h, _ := echoServer(t)
	code, out, _ := do(t, h, exchange{body: `{"jsonrpc":"2.0","method":"notifications/initialized"}`})
	if code != 202 || out != nil {
		t.Errorf("%d %v", code, out)
	}
}

func TestTransportRules(t *testing.T) {
	h, _ := echoServer(t)
	for _, m := range []string{http.MethodGet, http.MethodDelete} {
		if code, _, hdr := do(t, h, exchange{method: m}); code != 405 || hdr.Get("Allow") != "POST" {
			t.Errorf("%s: %d", m, code)
		}
	}
	if code, out, _ := do(t, h, exchange{body: `[` + legacy(1, "ping", "") + `]`}); code != 400 || errCode(out) != -32600 {
		t.Errorf("batch: %d %v", code, out)
	}
	if code, out, _ := do(t, h, exchange{body: `{not json`}); code != 400 || errCode(out) != -32700 {
		t.Errorf("parse error: %d %v", code, out)
	}
	if code, _, _ := do(t, h, exchange{body: `{"jsonrpc":"2.0","id":1,"result":{}}`}); code != 400 {
		t.Errorf("a client may not send responses: %d", code)
	}
	if code, _, _ := do(t, h, exchange{body: `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"` + strings.Repeat("x", 2<<20) + `"}}`}); code != 413 {
		t.Errorf("oversized body: %d", code)
	}
}
