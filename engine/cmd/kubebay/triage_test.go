package main

import "testing"

func TestNewTriageIsWiredAndBlockedInSharedEngines(t *testing.T) {
	a := newTriage(nil, nil, nil, nil, false, false)
	if a.Disabled != "" || a.Evidence == nil || a.Keys == nil || a.Getenv == nil || a.Audit == nil {
		t.Errorf("desktop engine: %+v", a)
	}
	if b := newTriage(nil, nil, nil, nil, true, false); b.Disabled == "" {
		t.Error("in-cluster engine must refuse triage")
	}
	if c := newTriage(nil, nil, nil, nil, false, true); c.Disabled == "" {
		t.Error("OIDC engine must refuse triage")
	}
}
