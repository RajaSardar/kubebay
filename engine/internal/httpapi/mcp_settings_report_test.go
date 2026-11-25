package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func getSettingsMap(t *testing.T, sm *SettingsManager) map[string]any {
	t.Helper()
	rec := httptest.NewRecorder()
	sm.HandleGet(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get: %d", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// GET /api/settings says who owns the MCP switch, on the desktop and on a
// shared engine, so the UI can lock the toggle with the reason.
func TestSettingsReportMCPReadOnly(t *testing.T) {
	sm := settingsWithManager(t)
	if got := getSettingsMap(t, sm); got["mcpReadOnly"] != nil || got["mcpLocked"] != nil {
		t.Errorf("unset: %v", got)
	}
	sm.MCPReadOnlyReason = "set by --mcp-read-only or KUBEBAY_MCP_READ_ONLY"
	got := getSettingsMap(t, sm)
	if got["mcpReadOnly"] != true || got["mcpReadOnlyReason"] != sm.MCPReadOnlyReason {
		t.Errorf("forced: %v", got)
	}
	sm.SharedLocked = SharedSettingsBlockReason(true, false)
	sm.MCPLocked = MCPBlockReason(true, false, true)
	got = getSettingsMap(t, sm)
	if got["mcpLocked"] != sm.MCPLocked || got["mcpReadOnly"] != true {
		t.Errorf("shared: %v", got)
	}
}
