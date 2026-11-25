package main

import (
	"strings"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
)

// mcpReadOnlyReason is shown beside the locked "propose changes" toggle.
const mcpReadOnlyReason = "set by --mcp-read-only or KUBEBAY_MCP_READ_ONLY"

// resolveMCPReadOnly: the operator's flag or env (1, true, yes, on) forces the
// MCP server read-only. It only ever tightens: a false env never undoes the flag.
func resolveMCPReadOnly(flagOn bool, env string) bool {
	if flagOn {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// mcpRefusalAudit records a write-tool call the read-only gate turned away.
// The gate runs before a tool's own audit wrapper, so it needs its own entry.
func mcpRefusalAudit(record func(audit.Entry)) func(mcp.CallInfo) {
	return func(ci mcp.CallInfo) {
		record(audit.Entry{
			Source:    "mcp",
			Action:    "mcp:refused:" + ci.Tool,
			Outcome:   "refused",
			Detail:    "request=" + ci.RequestID,
			UserAgent: strings.TrimSpace(ci.ClientName + " " + ci.ClientVersion),
		})
	}
}
