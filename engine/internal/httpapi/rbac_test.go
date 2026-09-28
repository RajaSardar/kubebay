package httpapi

import (
	rbacv1 "k8s.io/api/rbac/v1"
	"testing"
)

func TestRulesFrom_PreservesResourceNamesAndNonResourceURLs(t *testing.T) {
	rules := []rbacv1.PolicyRule{
		{
			Verbs:           []string{"get"},
			APIGroups:       []string{""},
			Resources:       []string{"secrets"},
			ResourceNames:   []string{"my-secret"},
			NonResourceURLs: []string{"/healthz"},
		},
	}
	out := rulesFrom(rules)
	if len(out) != 1 {
		t.Fatalf("want 1 rule, got %d", len(out))
	}
	if len(out[0].ResourceNames) != 1 || out[0].ResourceNames[0] != "my-secret" {
		t.Errorf("ResourceNames dropped: %+v", out[0])
	}
	if len(out[0].NonResourceURLs) != 1 || out[0].NonResourceURLs[0] != "/healthz" {
		t.Errorf("NonResourceURLs dropped: %+v", out[0])
	}
}
