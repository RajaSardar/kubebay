package httpapi

import "testing"

func TestHelmUpgradeAuditDetail(t *testing.T) {
	detail := helmUpgradeAuditDetail("autoscaler/vertical-pod-autoscaler", "1.2.3")

	if !containsSubstr(detail, "autoscaler/vertical-pod-autoscaler") {
		t.Errorf("detail = %q, want it to name the chart", detail)
	}
	if !containsSubstr(detail, "1.2.3") {
		t.Errorf("detail = %q, want it to name the version", detail)
	}
}

func TestHelmUpgradeAuditDetailNoVersion(t *testing.T) {
	// An empty version means "latest" -- the detail should say that plainly
	// rather than leaving a blank field.
	detail := helmUpgradeAuditDetail("autoscaler/vertical-pod-autoscaler", "")

	if !containsSubstr(detail, "latest") {
		t.Errorf("detail = %q, want it to say version=latest when unset", detail)
	}
}
