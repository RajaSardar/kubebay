package main

import (
	"strings"
	"testing"
)

func TestNewAIIsLockedOnSharedEngines(t *testing.T) {
	for name, c := range map[string]struct{ inCluster, shared bool }{"in-cluster": {true, false}, "oidc or proxy": {false, true}} {
		a := newAI(nil, nil, "127.0.0.1:7777", c.inCluster, c.shared)
		if a.Disabled == "" || !strings.Contains(a.Disabled, "AI investigations are off") {
			t.Errorf("%s: not locked: %q", name, a.Disabled)
		}
	}
	if a := newAI(nil, nil, "0.0.0.0:7777", false, false); a.Disabled == "" {
		t.Error("a non-loopback listener must lock it")
	}
	if a := newAI(nil, nil, "127.0.0.1:7777", false, false); a.Disabled != "" {
		t.Errorf("desktop: %q", a.Disabled)
	}
}

func TestNewAIOnlyAllowsKubebayReadTools(t *testing.T) {
	a := newAI(nil, nil, "127.0.0.1:7777", false, false)
	for _, tool := range a.Manager.Allowed {
		if !strings.HasPrefix(tool, "mcp__kubebay__") || strings.Contains(tool, "propose") {
			t.Errorf("unexpected tool %q", tool)
		}
	}
}
