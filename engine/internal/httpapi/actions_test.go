package httpapi

import "testing"

func TestResizePodAuditDetail(t *testing.T) {
	detail := resizePodAuditDetail("app", map[string]interface{}{
		"requests": map[string]interface{}{"cpu": "100m", "memory": "128Mi"},
	})
	if detail == "" {
		t.Fatal("detail should not be empty")
	}
	if got := detail; !containsSubstr(got, "container=app") {
		t.Errorf("detail = %q, want it to name the container", got)
	}
	if !containsSubstr(detail, "cpu") || !containsSubstr(detail, "100m") {
		t.Errorf("detail = %q, want it to mention the requested cpu", detail)
	}
}

func containsSubstr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
