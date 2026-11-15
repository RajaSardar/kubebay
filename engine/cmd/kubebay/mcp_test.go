package main

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

// `kubebay-engine mcp-stdio` finds the connection file from --connection,
// then KUBEBAY_MCP_CONNECTION, then ~/.kubebay/mcp.json; stdout carries
// only protocol messages.
func TestMCPStdioPicksTheConnectionFile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	line := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}` + "\n"
	for _, tc := range []struct {
		name, env string
		args      []string
		want      string
	}{
		{"default", "", nil, filepath.Join(home, ".kubebay", "mcp.json")},
		{"env", "/srv/kb/env.json", nil, "/srv/kb/env.json"},
		{"flag", "/srv/kb/env.json", []string{"--connection", "/srv/kb/flag.json"}, "/srv/kb/flag.json"},
	} {
		t.Setenv("KUBEBAY_MCP_CONNECTION", tc.env)
		var out, errw bytes.Buffer
		if code := runMCPStdio(tc.args, strings.NewReader(line), &out, &errw); code != 0 {
			t.Fatalf("%s: exit %d: %s", tc.name, code, errw.String())
		}
		if !strings.Contains(out.String(), tc.want) || !strings.Contains(out.String(), `"id":1`) {
			t.Errorf("%s: stdout = %s", tc.name, out.String())
		}
	}
	var out, errw bytes.Buffer
	if code := runMCPStdio([]string{"--nope"}, strings.NewReader(""), &out, &errw); code != 2 || out.Len() != 0 {
		t.Errorf("bad flag: exit %d, stdout %q", code, out.String())
	}
}
