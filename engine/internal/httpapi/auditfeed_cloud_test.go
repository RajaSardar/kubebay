package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func putAuditSource(sm *SettingsManager, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	sm.HandleSetAuditSource(rec, httptest.NewRequest(http.MethodPut, "/api/security/audit-source", strings.NewReader(body)))
	return rec
}

func TestAuditCloudSourceReadsThroughTheProviderCLI(t *testing.T) {
	sm := settingsWithManager(t)
	var ran []string
	sm.AuditRunner = func(_ context.Context, name string, args ...string) ([]byte, error) {
		ran = append([]string{name}, args...)
		b, _ := json.Marshal(map[string]any{"events": []any{map[string]any{"message": auditExecLine}}})
		return b, nil
	}
	if rec := putAuditSource(sm, `{"cluster":"kind-dev","source":{"kind":"eks","cluster":"prod","region":"eu-west-1"}}`); rec.Code != http.StatusOK {
		t.Fatalf("set source: %d %s", rec.Code, rec.Body)
	}
	code, out := getAuditEvents(t, sm, "kind-dev")
	if code != http.StatusOK || out["configured"] != true || out["source"] != "eks" || out["path"] != "CloudWatch /aws/eks/prod/cluster (eu-west-1)" {
		t.Fatalf("got %d %v", code, out)
	}
	if len(ran) == 0 || ran[0] != "aws" {
		t.Fatalf("ran %v", ran)
	}
	if evs, _ := out["events"].([]any); len(evs) != 1 {
		t.Fatalf("events = %v", out["events"])
	}

	save(t, sm, `{"prometheusUrl":"http://prom:9090"}`)
	if _, out := getAuditEvents(t, sm, "kind-dev"); out["source"] != "eks" {
		t.Fatal("saving other settings dropped the cloud audit source")
	}

	// Pointing at a file replaces the cloud source, and clearing stops both.
	log := filepath.Join(t.TempDir(), "audit.log")
	_ = os.WriteFile(log, []byte(auditExecLine+"\n"), 0o600)
	putAuditPath(t, sm, `{"cluster":"kind-dev","path":"`+log+`"}`)
	if _, out := getAuditEvents(t, sm, "kind-dev"); out["source"] != "file" || out["path"] != log {
		t.Fatalf("after setting a file: %v", out)
	}
	putAuditSource(sm, `{"cluster":"kind-dev","source":{"kind":"gke","project":"my-proj","location":"europe-west1","cluster":"prod"}}`)
	if _, out := getAuditEvents(t, sm, "kind-dev"); out["source"] != "gke" {
		t.Fatalf("after setting gke: %v", out)
	}
	putAuditPath(t, sm, `{"cluster":"kind-dev","path":""}`)
	if _, out := getAuditEvents(t, sm, "kind-dev"); out["configured"] != false {
		t.Fatalf("stop reading must clear the cloud source too: %v", out)
	}
}

func TestAuditCloudSourceRejectsBadValuesAndDeployments(t *testing.T) {
	sm := settingsWithManager(t)
	if rec := putAuditSource(sm, `{"cluster":"kind-dev","source":{"kind":"eks","cluster":"--endpoint-url=x"}}`); rec.Code != http.StatusBadRequest {
		t.Errorf("flag-like cluster: %d", rec.Code)
	}
	if rec := putAuditSource(sm, `{"source":{"kind":"eks","cluster":"prod"}}`); rec.Code != http.StatusBadRequest {
		t.Errorf("missing cluster: %d", rec.Code)
	}
	sm.AuditFeedDisabled = "off in OIDC mode"
	if rec := putAuditSource(sm, `{"cluster":"kind-dev","source":{"kind":"eks","cluster":"prod"}}`); rec.Code != http.StatusForbidden {
		t.Errorf("a shared deployment must not run cloud CLIs as the engine's user: %d", rec.Code)
	}
}

func TestAuditCloudCLIErrorIsShownNotThrown(t *testing.T) {
	sm := settingsWithManager(t)
	sm.AuditRunner = func(context.Context, string, ...string) ([]byte, error) {
		return nil, &os.PathError{Op: "exec", Path: "aws", Err: os.ErrNotExist}
	}
	putAuditSource(sm, `{"cluster":"kind-dev","source":{"kind":"eks","cluster":"prod"}}`)
	code, out := getAuditEvents(t, sm, "kind-dev")
	if code != http.StatusOK || out["error"] == nil || !strings.Contains(out["error"].(string), "aws") {
		t.Errorf("got %d %v", code, out)
	}
}
