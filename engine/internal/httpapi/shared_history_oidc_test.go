package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Internal security review: usage history is sampled with the engine's own
// identity, across every namespace. On a shared engine (in a cluster, or with
// OIDC on any host) it is not recorded at all, and no user can turn it on for
// everyone or erase it.

func TestHistoryBlockReason(t *testing.T) {
	if HistoryBlockReason(false, false) != "" {
		t.Error("desktop must keep usage history")
	}
	for _, c := range [][2]bool{{true, false}, {false, true}, {true, true}} {
		if HistoryBlockReason(c[0], c[1]) == "" {
			t.Errorf("in-cluster=%v oidc=%v must not record usage history", c[0], c[1])
		}
	}
}

func TestSharedEngineHistoryIgnoresEachUsersConsent(t *testing.T) {
	sm := settingsWithManager(t)
	reason := HistoryBlockReason(false, true)
	api := &HistoryAPI{Settings: sm, Unavailable: reason, Shared: reason}

	rec := httptest.NewRecorder()
	api.HandleEnroll(rec, signedIn(httptest.NewRequest(http.MethodPost, "/api/history/enroll?cluster=kind-dev", nil), alice))
	if rec.Code != http.StatusOK {
		t.Fatalf("enroll: %d %s", rec.Code, rec.Body)
	}
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["recording"] != false {
		t.Errorf("enroll says recording %v", got["recording"])
	}
	if sm.HistoryEnabled("kind-dev") {
		t.Error("alice's connect stored consent for everyone")
	}

	rec = httptest.NewRecorder()
	api.HandleRecording(rec, signedIn(httptest.NewRequest(http.MethodPut, "/api/history/recording?cluster=kind-dev&on=true", nil), bob))
	if rec.Code != http.StatusForbidden {
		t.Errorf("bob turned recording on for everyone: %d", rec.Code)
	}
	if sm.HistoryEnabled("kind-dev") {
		t.Error("consent stored")
	}

	rec = httptest.NewRecorder()
	api.HandleErase(rec, signedIn(httptest.NewRequest(http.MethodDelete, "/api/history?cluster=kind-dev", nil), bob))
	if rec.Code != http.StatusForbidden {
		t.Errorf("bob erased history: %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	api.HandleStatus(rec, signedIn(httptest.NewRequest(http.MethodGet, "/api/history/status?cluster=kind-dev", nil), alice))
	got = map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["available"] != false || got["reason"] != reason || got["recording"] != false {
		t.Errorf("status %v", got)
	}
}

func TestDesktopHistoryConsentStillWorks(t *testing.T) {
	sm := settingsWithManager(t)
	api := &HistoryAPI{Settings: sm, Unavailable: "no dir"}
	rec := httptest.NewRecorder()
	api.HandleEnroll(rec, httptest.NewRequest(http.MethodPost, "/api/history/enroll?cluster=kind-dev", nil))
	if rec.Code != http.StatusOK || !sm.HistoryEnabled("kind-dev") {
		t.Fatalf("enroll: %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	api.HandleRecording(rec, httptest.NewRequest(http.MethodPut, "/api/history/recording?cluster=kind-dev&on=false", nil))
	if rec.Code != http.StatusOK || sm.HistoryEnabled("kind-dev") {
		t.Fatalf("stop: %d %s", rec.Code, rec.Body)
	}
}
