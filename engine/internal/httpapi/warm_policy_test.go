package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func putWarm(sm *SettingsManager, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	sm.HandleWarmSave(rec, httptest.NewRequest(http.MethodPut, "/api/warm-policy", strings.NewReader(body)))
	return rec
}

func TestWarmPolicy_SaveAppliesLiveAndPersists(t *testing.T) {
	sm := settingsWithManager(t)
	if rec := putWarm(sm, `{"clusters":3,"idleMinutes":10}`); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	c, idle := sm.mgr.WarmPolicy()
	if c != 3 || idle != 10*time.Minute {
		t.Fatalf("manager policy = %d,%v", c, idle)
	}
	set, _ := sm.Load()
	if set.Warm == nil || set.Warm.Clusters != 3 || set.Warm.IdleMinutes != 10 {
		t.Fatalf("stored = %+v", set.Warm)
	}
	// A restart reads it back over the flag defaults.
	sm.mgr.SetWarmPolicy(5, 30*time.Minute)
	sm.ApplyStoredWarmPolicy()
	if c, idle := sm.mgr.WarmPolicy(); c != 3 || idle != 10*time.Minute {
		t.Fatalf("after restart = %d,%v", c, idle)
	}
}

func TestWarmPolicy_RejectsOutOfRange(t *testing.T) {
	sm := settingsWithManager(t)
	for _, body := range []string{`{"clusters":-1,"idleMinutes":5}`, `{"clusters":51,"idleMinutes":5}`, `{"clusters":3,"idleMinutes":-2}`, `{"clusters":3,"idleMinutes":2000}`, `nope`} {
		if rec := putWarm(sm, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s -> %d, want 400", body, rec.Code)
		}
	}
}

func TestWarmPolicy_DisabledDeploymentRefusesAndSaysWhy(t *testing.T) {
	sm := settingsWithManager(t)
	sm.WarmPolicyDisabled = "streams are shared between users"
	if rec := putWarm(sm, `{"clusters":3,"idleMinutes":10}`); rec.Code != http.StatusForbidden {
		t.Fatalf("save -> %d, want 403", rec.Code)
	}
	rec := httptest.NewRecorder()
	sm.HandleWarmGet(rec, httptest.NewRequest(http.MethodGet, "/api/warm-policy", nil))
	var got struct {
		Available bool   `json:"available"`
		Reason    string `json:"reason"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Available || got.Reason == "" {
		t.Fatalf("get = %+v", got)
	}
}

func TestWarmPolicy_GetReportsCurrentAndDefaults(t *testing.T) {
	sm := settingsWithManager(t)
	sm.mgr.SetWarmPolicy(7, 20*time.Minute)
	rec := httptest.NewRecorder()
	sm.HandleWarmGet(rec, httptest.NewRequest(http.MethodGet, "/api/warm-policy", nil))
	var got struct {
		Available          bool `json:"available"`
		Clusters           int  `json:"clusters"`
		IdleMinutes        int  `json:"idleMinutes"`
		DefaultClusters    int  `json:"defaultClusters"`
		DefaultIdleMinutes int  `json:"defaultIdleMinutes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Available || got.Clusters != 7 || got.IdleMinutes != 20 || got.DefaultClusters != 5 || got.DefaultIdleMinutes != 30 {
		t.Fatalf("get = %+v", got)
	}
}

func TestHandleSave_KeepsWarmPolicyWhenOmitted(t *testing.T) {
	sm := settingsWithManager(t)
	putWarm(sm, `{"clusters":3,"idleMinutes":10}`)
	save(t, sm, `{"prometheusUrl":"http://prom:9090"}`)
	set, _ := sm.Load()
	if set.Warm == nil || set.Warm.Clusters != 3 {
		t.Fatalf("warm policy lost: %+v", set.Warm)
	}
}
