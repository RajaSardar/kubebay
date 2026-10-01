package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const auditExecLine = `{"auditID":"a1","stage":"ResponseComplete","verb":"create","user":{"username":"alice"},"objectRef":{"resource":"pods","namespace":"shop","name":"api-1","subresource":"exec"},"responseStatus":{"code":101},"stageTimestamp":"2026-10-01T10:00:00Z"}`

func putAuditPath(t *testing.T, sm *SettingsManager, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	sm.HandleSetAuditLogPath(rec, httptest.NewRequest(http.MethodPut, "/api/security/audit-log-path", strings.NewReader(body)))
	return rec
}

func getAuditEvents(t *testing.T, sm *SettingsManager, cluster string) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	sm.HandleAuditEvents(rec, httptest.NewRequest(http.MethodGet, "/api/security/audit-events?cluster="+cluster, nil))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestAuditEventsUnconfigured(t *testing.T) {
	sm := settingsWithManager(t)
	code, out := getAuditEvents(t, sm, "kind-dev")
	if code != http.StatusOK || out["configured"] != false {
		t.Fatalf("got %d %v", code, out)
	}
}

func TestAuditLogPathRoundTripAndEvents(t *testing.T) {
	sm := settingsWithManager(t)
	log := filepath.Join(t.TempDir(), "audit.log")
	if err := os.WriteFile(log, []byte(auditExecLine+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if rec := putAuditPath(t, sm, `{"cluster":"kind-dev","path":"`+log+`"}`); rec.Code != http.StatusOK {
		t.Fatalf("set path: %d %s", rec.Code, rec.Body)
	}
	code, out := getAuditEvents(t, sm, "kind-dev")
	if code != http.StatusOK || out["configured"] != true || out["path"] != log {
		t.Fatalf("got %d %v", code, out)
	}
	evs, _ := out["events"].([]any)
	if len(evs) != 1 || evs[0].(map[string]any)["rule"] != "exec-into-pod" {
		t.Fatalf("events = %v", out["events"])
	}

	// A settings save that doesn't mention audit paths keeps them.
	save(t, sm, `{"prometheusUrl":"http://prom:9090"}`)
	if _, out := getAuditEvents(t, sm, "kind-dev"); out["configured"] != true {
		t.Fatal("saving other settings dropped the audit log path")
	}

	// Clearing it.
	if rec := putAuditPath(t, sm, `{"cluster":"kind-dev","path":""}`); rec.Code != http.StatusOK {
		t.Fatalf("clear: %d", rec.Code)
	}
	if _, out := getAuditEvents(t, sm, "kind-dev"); out["configured"] != false {
		t.Fatal("cleared path still configured")
	}
}

func TestAuditLogPathMustBeAReadableAbsoluteFile(t *testing.T) {
	sm := settingsWithManager(t)
	for _, body := range []string{
		`{"cluster":"kind-dev","path":"relative/audit.log"}`,
		`{"cluster":"kind-dev","path":"/does/not/exist.log"}`,
		`{"cluster":"kind-dev","path":"` + t.TempDir() + `"}`,
		`{"path":"/tmp/x"}`,
	} {
		if rec := putAuditPath(t, sm, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", body, rec.Code)
		}
	}
}

func TestAuditEventsReportsAnUnreadableLog(t *testing.T) {
	sm := settingsWithManager(t)
	log := filepath.Join(t.TempDir(), "audit.log")
	_ = os.WriteFile(log, []byte(auditExecLine+"\n"), 0o600)
	putAuditPath(t, sm, `{"cluster":"kind-dev","path":"`+log+`"}`)
	_ = os.Remove(log)
	code, out := getAuditEvents(t, sm, "kind-dev")
	if code != http.StatusOK || out["configured"] != true || out["error"] == nil || out["error"] == "" {
		t.Fatalf("got %d %v", code, out)
	}
}

func TestAuditFeedOffWhenOIDCOrInCluster(t *testing.T) {
	if AuditFeedBlockReason(false, false) != "" {
		t.Fatal("a desktop deployment allows the feed")
	}
	for _, tc := range []struct {
		name               string
		inCluster, oidc    bool
		wantReasonContains string
	}{
		{"oidc", false, true, "OIDC"},
		{"in-cluster", true, false, "in-cluster"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sm := settingsWithManager(t)
			sm.AuditFeedDisabled = AuditFeedBlockReason(tc.inCluster, tc.oidc)
			if !strings.Contains(sm.AuditFeedDisabled, tc.wantReasonContains) {
				t.Fatalf("reason %q should mention %q", sm.AuditFeedDisabled, tc.wantReasonContains)
			}
			if rec := putAuditPath(t, sm, `{"cluster":"kind-dev","path":"/does/not/exist.log"}`); rec.Code != http.StatusForbidden ||
				!strings.Contains(rec.Body.String(), "engine host") || strings.Contains(rec.Body.String(), "no such file") {
				t.Errorf("set path: %d %q, want 403 with the reason and no path probing", rec.Code, rec.Body.String())
			}
			rec := httptest.NewRecorder()
			sm.HandleAuditEvents(rec, httptest.NewRequest(http.MethodGet, "/api/security/audit-events?cluster=kind-dev", nil))
			if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "engine host") {
				t.Errorf("events: %d %q, want 403 with the reason", rec.Code, rec.Body.String())
			}
		})
	}
}
