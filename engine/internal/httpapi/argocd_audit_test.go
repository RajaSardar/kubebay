package httpapi

import "testing"

func TestArgoCDRefreshAuditEntry(t *testing.T) {
	e := argoCDRefreshAuditEntry("prod", "argocd", "web", "UA/1")
	if e.Action != "argocd-hard-refresh" {
		t.Errorf("action = %q", e.Action)
	}
	if e.GVR != "argoproj.io/v1alpha1/applications" {
		t.Errorf("gvr = %q, want the Application GVR", e.GVR)
	}
	if e.Cluster != "prod" || e.Namespace != "argocd" || e.Resource != "web" || e.UserAgent != "UA/1" {
		t.Errorf("entry = %+v", e)
	}
}
