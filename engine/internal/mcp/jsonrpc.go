// Package mcp is Kubebay's built-in Model Context Protocol server (backlog
// #5): a stateless, JSON-only Streamable HTTP endpoint. It speaks both eras of
// the protocol, the stateless 2026-07-28 revision (per-request _meta,
// server/discover) and the 2025-03-26 … 2025-11-25 initialize handshake, but
// only what read-only tools need: discovery, tools/list and tools/call. No
// SSE stream, no sessions, no requests to the client.
package mcp

import "encoding/json"

// JSON-RPC 2.0 and MCP error codes.
const (
	codeParseError     = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
	codeInternal       = -32603
	// MCP-reserved range (2026-07-28).
	codeHeaderMismatch      = -32020
	codeUnsupportedProtocol = -32022
)

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	// A client must not send responses; their presence marks one.
	Result json.RawMessage `json:"result,omitempty"`
	Error  json.RawMessage `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// metaKey names in the io.modelcontextprotocol/ namespace (2026-07-28).
const (
	metaProtocolVersion = "io.modelcontextprotocol/protocolVersion"
	metaClientInfo      = "io.modelcontextprotocol/clientInfo"
	metaServerInfo      = "io.modelcontextprotocol/serverInfo"
)

type clientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// params is the subset of request params the dispatcher reads.
type params struct {
	Meta            map[string]json.RawMessage `json:"_meta"`
	Name            string                     `json:"name"`
	Arguments       json.RawMessage            `json:"arguments"`
	ProtocolVersion string                     `json:"protocolVersion"` // legacy initialize
	ClientInfo      *clientInfo                `json:"clientInfo"`      // legacy initialize
}
