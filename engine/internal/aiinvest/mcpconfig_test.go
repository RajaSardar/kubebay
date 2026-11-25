package aiinvest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteMCPConfig(t *testing.T) {
	dir := t.TempDir()
	p, err := WriteMCPConfig(dir, "http://127.0.0.1:7777/mcp", "run-token-123")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(p) == dir {
		t.Fatalf("config must not sit in a directory the model could be pointed at: %s", p)
	}
	st, _ := os.Stat(p)
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", st.Mode().Perm())
	}
	b, _ := os.ReadFile(p)
	var c struct {
		McpServers map[string]struct {
			Type    string            `json:"type"`
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	s, ok := c.McpServers["kubebay"]
	if len(c.McpServers) != 1 || !ok || s.Type != "http" || s.URL != "http://127.0.0.1:7777/mcp" || s.Headers["Authorization"] != "Bearer run-token-123" {
		t.Fatalf("unexpected config: %s", b)
	}
}

func TestWriteMCPConfigRefusesNonLoopback(t *testing.T) {
	for _, u := range []string{"http://example.com/mcp", "https://10.0.0.5/mcp", "file:///etc/passwd", "http://127.0.0.1.evil.com/mcp"} {
		if _, err := WriteMCPConfig(t.TempDir(), u, "t"); err == nil || !strings.Contains(err.Error(), "loopback") {
			t.Errorf("%s: want loopback refusal, got %v", u, err)
		}
	}
}
