package main

import (
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
)

func TestResolveMCPReadOnly(t *testing.T) {
	cases := []struct {
		flag bool
		env  string
		want bool
	}{
		{false, "", false},
		{true, "", true},
		{false, "1", true},
		{false, "true", true},
		{false, "YES", true},
		{false, " on ", true},
		{false, "0", false},
		{false, "false", false},
		{false, "banana", false},
		{true, "false", true}, // the flag only ever tightens
	}
	for _, c := range cases {
		if got := resolveMCPReadOnly(c.flag, c.env); got != c.want {
			t.Errorf("resolveMCPReadOnly(%v,%q) = %v, want %v", c.flag, c.env, got, c.want)
		}
	}
}

func TestMCPRefusalIsAudited(t *testing.T) {
	var got []audit.Entry
	fn := mcpRefusalAudit(func(e audit.Entry) { got = append(got, e) })
	fn(mcp.CallInfo{Tool: "propose_change", ClientName: "claude-desktop", ClientVersion: "1.0", RequestID: "7"})
	if len(got) != 1 {
		t.Fatalf("entries = %v", got)
	}
	e := got[0]
	if e.Action != "mcp:refused:propose_change" || e.Source != "mcp" || e.Outcome != "refused" || e.UserAgent != "claude-desktop 1.0" || e.Detail != "request=7" {
		t.Fatalf("entry = %+v", e)
	}
}
