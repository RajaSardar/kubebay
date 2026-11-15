package mcp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// The protocol versions this server speaks, newest first.
const latestModern = "2026-07-28"

var (
	modernVersions = []string{latestModern}
	// The initialize-handshake era. 2025-03-26 is what a client that sends no
	// MCP-Protocol-Version header speaks (the header arrived in 2025-06-18).
	legacyVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26"}
)

func supported(v string, list []string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// maxBody bounds one JSON-RPC message.
const maxBody = 1 << 20

// Handler serves the MCP endpoint. Authentication and Origin checks sit in
// front of it (httpapi); it trusts that the caller got that far.
type Handler struct {
	Tools   *Registry
	Name    string
	Version string
	// Instructions is shown to the model by clients that surface it.
	Instructions string
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		// No SSE stream and no sessions: GET (stream) and DELETE (end session) don't apply.
		w.Header().Set("Allow", "POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		writeErr(w, http.StatusBadRequest, nil, codeParseError, "unreadable body", nil)
		return
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 && trimmed[0] == '[' {
		// Batching was removed in 2025-06-18.
		writeErr(w, http.StatusBadRequest, nil, codeInvalidRequest, "batched requests are not supported", nil)
		return
	}
	var req request
	if err := json.Unmarshal(trimmed, &req); err != nil {
		writeErr(w, http.StatusBadRequest, nil, codeParseError, "parse error: "+err.Error(), nil)
		return
	}
	if req.JSONRPC != "2.0" || req.Method == "" || len(req.Result) > 0 || len(req.Error) > 0 {
		writeErr(w, http.StatusBadRequest, req.ID, codeInvalidRequest, "expected a JSON-RPC 2.0 request or notification", nil)
		return
	}
	if len(req.ID) == 0 || string(req.ID) == "null" {
		// A notification (notifications/initialized, notifications/cancelled…).
		// Nothing here is long-running enough to cancel, so accepting is all.
		w.WriteHeader(http.StatusAccepted)
		return
	}
	var p params
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &p); err != nil {
			writeErr(w, http.StatusBadRequest, req.ID, codeInvalidParams, "invalid params: "+err.Error(), nil)
			return
		}
	}

	bodyVersion := metaString(p.Meta, metaProtocolVersion)
	if bodyVersion != "" || req.Method == "server/discover" {
		h.serveModern(w, r, req, p, bodyVersion)
		return
	}
	h.serveLegacy(w, r, req, p)
}

func metaString(meta map[string]json.RawMessage, key string) string {
	var s string
	if raw, ok := meta[key]; ok {
		_ = json.Unmarshal(raw, &s)
	}
	return s
}

// decodeHeader undoes the =?base64?…?= sentinel encoding of Mcp-Name.
func decodeHeader(v string) (string, bool) {
	if strings.HasPrefix(v, "=?base64?") && strings.HasSuffix(v, "?=") && len(v) >= len("=?base64??=") {
		b, err := base64.StdEncoding.DecodeString(v[len("=?base64?") : len(v)-len("?=")])
		if err != nil {
			return "", false
		}
		return string(b), true
	}
	return v, true
}

// serveModern handles the stateless 2026-07-28 revision: every request
// carries its version in _meta, mirrored into headers that must match.
func (h *Handler) serveModern(w http.ResponseWriter, r *http.Request, req request, p params, bodyVersion string) {
	headerVersion := r.Header.Get("MCP-Protocol-Version")
	switch {
	case headerVersion == "":
		writeErr(w, http.StatusBadRequest, req.ID, codeHeaderMismatch, "missing MCP-Protocol-Version header", nil)
		return
	case bodyVersion != "" && headerVersion != bodyVersion:
		writeErr(w, http.StatusBadRequest, req.ID, codeHeaderMismatch,
			fmt.Sprintf("header mismatch: MCP-Protocol-Version %q does not match body %q", headerVersion, bodyVersion), nil)
		return
	}
	if r.Header.Get("Mcp-Method") != req.Method {
		writeErr(w, http.StatusBadRequest, req.ID, codeHeaderMismatch,
			fmt.Sprintf("header mismatch: Mcp-Method %q does not match body %q", r.Header.Get("Mcp-Method"), req.Method), nil)
		return
	}
	version := headerVersion
	if !supported(version, modernVersions) {
		writeErr(w, http.StatusBadRequest, req.ID, codeUnsupportedProtocol,
			fmt.Sprintf("unsupported protocol version %q", version),
			map[string]any{"supported": modernVersions, "requested": version})
		return
	}
	switch req.Method {
	case "server/discover":
		writeResult(w, req.ID, map[string]any{
			"resultType":        "complete",
			"supportedVersions": modernVersions,
			"capabilities":      map[string]any{"tools": map[string]any{}},
			"instructions":      h.Instructions,
			"ttlMs":             60_000,
			"cacheScope":        "private",
			"_meta":             h.serverMeta(),
		})
	case "tools/list":
		writeResult(w, req.ID, map[string]any{
			"resultType": "complete",
			"tools":      h.Tools.list(),
			"ttlMs":      60_000,
			"cacheScope": "private",
			"_meta":      h.serverMeta(),
		})
	case "tools/call":
		name, ok := decodeHeader(r.Header.Get("Mcp-Name"))
		if !ok || name != p.Name {
			writeErr(w, http.StatusBadRequest, req.ID, codeHeaderMismatch,
				fmt.Sprintf("header mismatch: Mcp-Name %q does not match body %q", r.Header.Get("Mcp-Name"), p.Name), nil)
			return
		}
		var ci clientInfo
		if raw, ok := p.Meta[metaClientInfo]; ok {
			_ = json.Unmarshal(raw, &ci)
		}
		res := h.call(r.Context(), p, ci, req.ID)
		writeResult(w, req.ID, struct {
			Result
			ResultType string         `json:"resultType"`
			Meta       map[string]any `json:"_meta"`
		}{res, "complete", h.serverMeta()})
	default:
		writeErr(w, http.StatusNotFound, req.ID, codeMethodNotFound, "method not found: "+req.Method, nil)
	}
}

// serveLegacy handles 2025-03-26 … 2025-11-25 clients. The handshake is
// answered, but nothing is remembered: every request stands alone.
func (h *Handler) serveLegacy(w http.ResponseWriter, r *http.Request, req request, p params) {
	if v := r.Header.Get("MCP-Protocol-Version"); v != "" && !supported(v, legacyVersions) {
		writeErr(w, http.StatusBadRequest, req.ID, codeInvalidRequest,
			fmt.Sprintf("unsupported MCP-Protocol-Version %q", v), map[string]any{"supported": append(append([]string{}, modernVersions...), legacyVersions...)})
		return
	}
	switch req.Method {
	case "initialize":
		version := legacyVersions[0]
		if supported(p.ProtocolVersion, legacyVersions) {
			version = p.ProtocolVersion
		}
		writeResult(w, req.ID, map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]string{"name": h.Name, "version": h.Version},
			"instructions":    h.Instructions,
		})
	case "ping":
		writeResult(w, req.ID, map[string]any{})
	case "tools/list":
		writeResult(w, req.ID, map[string]any{"tools": h.Tools.list()})
	case "tools/call":
		ci := clientInfo{Name: r.Header.Get("User-Agent")}
		writeResult(w, req.ID, h.call(r.Context(), p, ci, req.ID))
	default:
		writeErr(w, http.StatusOK, req.ID, codeMethodNotFound, "method not found: "+req.Method, nil)
	}
}

func (h *Handler) serverMeta() map[string]any {
	return map[string]any{metaServerInfo: map[string]string{"name": h.Name, "version": h.Version}}
}

// call runs one tool. Every failure, including an unknown tool or bad
// arguments, is a tool result with isError so the model can see and correct it.
func (h *Handler) call(ctx context.Context, p params, ci clientInfo, id json.RawMessage) Result {
	tool, ok := h.Tools.Get(p.Name)
	if !ok {
		return Result{Content: []Content{{Type: "text", Text: "unknown tool: " + p.Name}}, IsError: true}
	}
	args := p.Arguments
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage(`{}`)
	}
	res, err := tool.Handler(ctx, args, CallInfo{
		Tool:          p.Name,
		ClientName:    ci.Name,
		ClientVersion: ci.Version,
		RequestID:     strings.Trim(string(id), `"`),
	})
	if err != nil {
		return Result{Content: []Content{{Type: "text", Text: err.Error()}}, IsError: true}
	}
	if res.Content == nil {
		res.Content = []Content{}
	}
	return res
}

func writeResult(w http.ResponseWriter, id json.RawMessage, result any) {
	writeJSON(w, http.StatusOK, response{JSONRPC: "2.0", ID: id, Result: result})
}

func writeErr(w http.ResponseWriter, status int, id json.RawMessage, code int, msg string, data any) {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	writeJSON(w, status, response{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: msg, Data: data}})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
