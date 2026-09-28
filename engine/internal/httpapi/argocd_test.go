package httpapi

import "testing"

func TestParseArgoCDResources(t *testing.T) {
	obj := map[string]interface{}{
		"status": map[string]interface{}{
			"resources": []interface{}{
				map[string]interface{}{
					"group":     "apps",
					"kind":      "Deployment",
					"namespace": "default",
					"name":      "my-app",
					"status":    "OutOfSync",
					"health": map[string]interface{}{
						"status": "Degraded",
					},
				},
				map[string]interface{}{
					"kind":      "Service",
					"namespace": "default",
					"name":      "my-svc",
					"status":    "Synced",
				},
			},
		},
	}

	got := parseArgoCDResources(obj)
	if len(got) != 2 {
		t.Fatalf("want 2 resources, got %d", len(got))
	}
	if got[0].Kind != "Deployment" || got[0].Name != "my-app" || got[0].Status != "OutOfSync" {
		t.Errorf("resource[0] = %+v, want Deployment/my-app/OutOfSync", got[0])
	}
	if got[0].Health != "Degraded" {
		t.Errorf("resource[0].Health = %q, want Degraded", got[0].Health)
	}
	if got[0].Group != "apps" {
		t.Errorf("resource[0].Group = %q, want apps", got[0].Group)
	}
	// A resource with no health block should not panic and should report "".
	if got[1].Health != "" {
		t.Errorf("resource[1].Health = %q, want empty", got[1].Health)
	}
}

func TestParseArgoCDResources_MissingOrMalformed(t *testing.T) {
	if got := parseArgoCDResources(map[string]interface{}{}); len(got) != 0 {
		t.Errorf("no status: want 0 resources, got %d", len(got))
	}
	if got := parseArgoCDResources(map[string]interface{}{"status": map[string]interface{}{}}); len(got) != 0 {
		t.Errorf("no resources key: want 0, got %d", len(got))
	}
	// A malformed entry (not a map) must be skipped, not panic the handler.
	obj := map[string]interface{}{
		"status": map[string]interface{}{
			"resources": []interface{}{"not-a-map", 42, nil},
		},
	}
	if got := parseArgoCDResources(obj); len(got) != 0 {
		t.Errorf("malformed entries: want 0 resources, got %d", len(got))
	}
}

func TestArgoCDResource_IsDrifted(t *testing.T) {
	if got := (argoCDResource{Status: "OutOfSync"}).isDrifted(); !got {
		t.Error("OutOfSync should be drifted")
	}
	if got := (argoCDResource{Status: "Synced"}).isDrifted(); got {
		t.Error("Synced should not be drifted")
	}
}
