package aiinvest

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
)

// WriteMCPConfig writes the --mcp-config file under root/cfg (a sibling of
// the empty working directory, never inside it) with exactly one server:
// Kubebay's own MCP endpoint on loopback, authenticated by the run token.
func WriteMCPConfig(root, mcpURL, token string) (string, error) {
	u, err := url.Parse(mcpURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", fmt.Errorf("aiinvest: the MCP endpoint must be a loopback http URL, got %q", mcpURL)
	}
	ip := net.ParseIP(u.Hostname())
	if u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return "", fmt.Errorf("aiinvest: the MCP endpoint must be on a loopback address, got %q", u.Hostname())
	}
	dir := filepath.Join(root, "cfg")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	b, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{
		ServerName: map[string]any{
			"type":    "http",
			"url":     mcpURL,
			"headers": map[string]string{"Authorization": "Bearer " + token},
		},
	}})
	p := filepath.Join(dir, "mcp.json")
	if err := os.WriteFile(p, b, 0o600); err != nil {
		return "", err
	}
	return p, nil
}
