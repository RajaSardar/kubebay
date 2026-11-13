package httpapi

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestCRDsFromDiscoveryKeepsOnlyListableCustomResources(t *testing.T) {
	lists := []*metav1.APIResourceList{
		{
			GroupVersion: "argoproj.io/v1alpha1",
			APIResources: []metav1.APIResource{
				{Name: "rollouts", SingularName: "rollout", Namespaced: true, Kind: "Rollout", ShortNames: []string{"ro"}, Verbs: metav1.Verbs{"get", "list", "watch"}},
				{Name: "rollouts/status", Kind: "Rollout", Verbs: metav1.Verbs{"get"}},
				{Name: "analysisruns", Namespaced: true, Kind: "AnalysisRun", Verbs: metav1.Verbs{"get"}},
			},
		},
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{{Name: "deployments", Kind: "Deployment", Namespaced: true, Verbs: metav1.Verbs{"list", "watch"}}},
		},
		{
			GroupVersion: "acme.example/v1",
			APIResources: []metav1.APIResource{{Name: "widgets", Kind: "Widget", Namespaced: false, Verbs: metav1.Verbs{"list", "watch"}}},
		},
	}
	names := map[string]bool{"rollouts.argoproj.io": true, "analysisruns.argoproj.io": true, "widgets.acme.example": true}
	got := crdsFromDiscovery(lists, names)
	if len(got) != 2 {
		t.Fatalf("got %+v; want rollouts and widgets (analysisruns can't be watched, deployments are not a CRD, rollouts/status is a subresource)", got)
	}
	r := got[0]
	if r.Name != "rollouts.argoproj.io" || r.Group != "argoproj.io" || r.Version != "v1alpha1" || r.Plural != "rollouts" || r.Singular != "rollout" || r.Kind != "Rollout" || !r.Namespaced || len(r.ShortNames) != 1 {
		t.Errorf("rollouts = %+v", r)
	}
	if w := got[1]; w.Name != "widgets.acme.example" || w.Namespaced {
		t.Errorf("widgets = %+v", w)
	}
}

func TestCRDsFromDiscoveryIgnoresAGroupVersionItCannotRead(t *testing.T) {
	lists := []*metav1.APIResourceList{nil, {GroupVersion: "not a group version/ /"}}
	if got := crdsFromDiscovery(lists, map[string]bool{"x.y": true}); len(got) != 0 {
		t.Errorf("got %+v", got)
	}
}
