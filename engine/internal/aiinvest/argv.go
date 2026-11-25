// Package aiinvest hands a problem to the user's own locally installed Claude
// Code CLI (backlog 78). Claude Code only: no other provider, no API key kept
// by Kubebay, no hosted service. The model gets no built-in tools; its only
// way to look at a cluster is Kubebay's own MCP server, mounted read-only
// with a per-run token.
package aiinvest

import (
	"errors"
	"path/filepath"
	"strings"
)

// ServerName is the one MCP server a run may use.
const ServerName = "kubebay"

// ToolPrefix prefixes every allowed tool name.
const ToolPrefix = "mcp__" + ServerName + "__"

// builtinDeny names every built-in tool a regression could re-enable. It is
// belt and braces: --tools "" already removes them all.
var builtinDeny = []string{"Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit"}

// Run is what BuildArgs needs.
type Run struct {
	Prompt        string
	MCPConfigPath string
	// AllowedTools are exact MCP read-tool names, mcp__kubebay__<tool>.
	AllowedTools []string
}

// BuildArgs is the only place the claude command line is made. Flags were
// checked against `claude --help` (2.1.286); nothing here is guessed:
//
//	--tools ""            disables every built-in tool ("Use "" to disable all tools")
//	--strict-mcp-config   only the generated --mcp-config, no other MCP source
//	--allowedTools        exact read-tool names, no wildcard
//	--permission-mode dontAsk + --permission-prompts none: anything not
//	                      allowed is denied, nobody is asked
//	--restricted          ignores user, project and local settings files
//	                      (hooks, extra MCP servers, allow rules); the
//	                      documented spelling, used instead of an empty
//	                      --setting-sources whose behaviour --help does not state
//	--no-session-persistence  nothing is kept on disk
//
// --bare is not used: it reads no OAuth or keychain login, so it would break
// the user's own Claude Code account. --help lists no max-turns flag, so
// the wall-clock and output caps (limits.go) bound a run instead.
func BuildArgs(r Run) ([]string, error) {
	if strings.TrimSpace(r.Prompt) == "" {
		return nil, errors.New("aiinvest: empty prompt")
	}
	if !filepath.IsAbs(r.MCPConfigPath) {
		return nil, errors.New("aiinvest: the MCP config path must be absolute")
	}
	if len(r.AllowedTools) == 0 {
		return nil, errors.New("aiinvest: no tools allowed")
	}
	for _, t := range r.AllowedTools {
		if !strings.HasPrefix(t, ToolPrefix) || strings.ContainsAny(t, "*? ") || len(t) == len(ToolPrefix) {
			return nil, errors.New("aiinvest: only exact " + ToolPrefix + "<tool> names may be allowed, got " + t)
		}
	}
	a := []string{
		"-p", r.Prompt,
		"--output-format", "stream-json", "--verbose",
		"--tools", "",
		"--strict-mcp-config", "--mcp-config", r.MCPConfigPath,
		"--allowedTools",
	}
	a = append(a, r.AllowedTools...)
	a = append(a, "--disallowedTools")
	a = append(a, builtinDeny...)
	a = append(a,
		"--permission-mode", "dontAsk",
		"--permission-prompts", "none",
		"--restricted",
		"--no-session-persistence",
		"--append-system-prompt", SystemInstruction,
	)
	return a, nil
}
