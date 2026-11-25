package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Backlog 81: "is identity shared between people" is OIDC or an auth proxy.
// main.go computes it once as sharedIdentity; reading auth.Enabled() or the
// OIDC issuer anywhere else would leave a proxy-mode engine with a local
// shell, shared Helm repos, the MCP token or the audit feed open to everyone.
func TestMainUsesOneSharedIdentityBoolean(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(src)
	if !strings.Contains(text, "sharedIdentity :=") {
		t.Fatal("main.go does not define sharedIdentity")
	}
	for i, line := range strings.Split(text, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "//") {
			continue
		}
		if strings.Contains(line, "auth.Enabled()") && !strings.Contains(line, "sharedIdentity :=") {
			t.Errorf("main.go:%d reads auth.Enabled() instead of sharedIdentity: %s", i+1, trim)
		}
	}
	if regexp.MustCompile(`oidcIssuer\s*[=!]=\s*""`).MatchString(text) {
		t.Error("main.go compares the OIDC issuer directly; use sharedIdentity")
	}
	// Every shared-state helper must be handed it.
	for _, call := range []string{"setupLocalShell(", "SharedHelmReposBlockReason(", "AuditFeedBlockReason(", "WarmPolicyBlockReason(", "SharedSettingsBlockReason(", "HistoryBlockReason(", "TimelineBlockReason(", "newMCP(", "newRolloutsDash(", "newTriage(", "newExtensions(", "DiscoveryBlockReason("} {
		found := false
		for _, line := range strings.Split(text, "\n") {
			if strings.Contains(line, call) && strings.Contains(line, "sharedIdentity") {
				found = true
			}
		}
		if !found {
			t.Errorf("%s is not passed sharedIdentity", call)
		}
	}
}
