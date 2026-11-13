package searchindex

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func bySlug(ks []Kind) map[string]Kind {
	m := map[string]Kind{}
	for _, k := range ks {
		m[k.Slug] = k
	}
	return m
}

func TestBuiltinKindsCoverTheCommonObjectsAndLeaveOutWhatTheAppAlreadyFollows(t *testing.T) {
	ks := bySlug(BuiltinKinds())
	for _, want := range []string{"services", "ingresses", "configmaps", "secrets", "persistentvolumeclaims", "serviceaccounts", "roles", "clusterrolebindings", "cronjobs", "replicasets", "horizontalpodautoscalers", "networkpolicies", "storageclasses"} {
		k, ok := ks[want]
		if !ok {
			t.Errorf("missing %s", want)
			continue
		}
		if k.Tier != TierDefault {
			t.Errorf("%s should be searched by default", want)
		}
	}
	// The app already holds these in memory and searches them itself.
	for _, local := range []string{"pods", "deployments", "statefulsets", "daemonsets", "jobs", "nodes", "namespaces"} {
		if _, ok := ks[local]; ok {
			t.Errorf("%s is searched by the palette locally; the engine must not follow it a second time", local)
		}
	}
}

func TestHighChurnAndBulkyKindsAreOnDemand(t *testing.T) {
	ks := bySlug(BuiltinKinds())
	for _, slug := range []string{"events", "leases", "endpoints", "endpointslices", "controllerrevisions", "policyreports", "vulnerabilityreports"} {
		k, ok := ks[slug]
		if !ok {
			t.Errorf("missing %s: it must still be reachable by naming it", slug)
			continue
		}
		if k.Tier != TierOnDemand {
			t.Errorf("%s should be on demand", slug)
		}
	}
}

func TestEveryKindHasLabelGVRAndUniqueWords(t *testing.T) {
	seenAlias, seenSlug, seenGVR := map[string]string{}, map[string]bool{}, map[string]bool{}
	for _, k := range BuiltinKinds() {
		if k.Label == "" || k.GVR == "" || k.Slug == "" {
			t.Errorf("incomplete kind %+v", k)
		}
		if seenSlug[k.Slug] || seenGVR[k.GVR] {
			t.Errorf("duplicate kind %s / %s", k.Slug, k.GVR)
		}
		seenSlug[k.Slug], seenGVR[k.GVR] = true, true
		for _, a := range k.Aliases {
			if a != strings.ToLower(a) {
				t.Errorf("alias %q of %s is not lower case", a, k.Slug)
			}
			if other, dup := seenAlias[a]; dup {
				t.Errorf("alias %q names both %s and %s", a, other, k.Slug)
			}
			seenAlias[a] = k.Slug
		}
	}
}

func TestEverydayShortNamesWork(t *testing.T) {
	al := map[string]string{}
	for _, k := range BuiltinKinds() {
		for _, a := range k.Aliases {
			al[a] = k.Slug
		}
	}
	for word, slug := range map[string]string{"svc": "services", "ing": "ingresses", "cm": "configmaps", "pvc": "persistentvolumeclaims", "sa": "serviceaccounts", "cj": "cronjobs", "rs": "replicasets", "hpa": "horizontalpodautoscalers", "netpol": "networkpolicies", "secret": "secrets", "ev": "events"} {
		if al[word] != slug {
			t.Errorf("%q names %q, want %q", word, al[word], slug)
		}
	}
}

func rollouts() CRD {
	return CRD{Name: "rollouts.argoproj.io", Group: "argoproj.io", Version: "v1alpha1", Plural: "rollouts", Singular: "rollout", Kind: "Rollout", ShortNames: []string{"ro"}, Namespaced: true}
}

func TestACustomResourceFromAKnownGroupIsSearchedByDefault(t *testing.T) {
	ks := CRDKinds([]CRD{rollouts()}, nil, nil)
	k := bySlug(ks)["ext--argoproj.io--v1alpha1--rollouts"]
	if k.Slug == "" {
		t.Fatalf("no kind for rollouts: %+v", ks)
	}
	if k.GVR != "argoproj.io/v1alpha1/rollouts" || k.Tier != TierDefault || k.Label != "Rollouts" {
		t.Errorf("got %+v", k)
	}
	for _, w := range []string{"rollout", "rollouts", "ro", "rollouts.argoproj.io"} {
		found := false
		for _, a := range k.Aliases {
			found = found || a == w
		}
		if !found {
			t.Errorf("alias %q missing from %v", w, k.Aliases)
		}
	}
}

func TestACustomResourceFromAnUnknownGroupIsOnDemand(t *testing.T) {
	c := CRD{Name: "widgets.acme.example", Group: "acme.example", Version: "v1", Plural: "widgets", Singular: "widget", Kind: "Widget", Namespaced: true}
	k := bySlug(CRDKinds([]CRD{c}, nil, nil))["ext--acme.example--v1--widgets"]
	if k.Tier != TierOnDemand {
		t.Errorf("an unfamiliar group's objects could be countless: %+v", k)
	}
}

func TestReportKindsAreNeverFollowedByDefaultEvenFromAKnownGroup(t *testing.T) {
	c := CRD{Name: "vulnerabilityreports.aquasecurity.github.io", Group: "aquasecurity.github.io", Version: "v1alpha1", Plural: "vulnerabilityreports", Kind: "VulnerabilityReport", Namespaced: true}
	if k := bySlug(CRDKinds([]CRD{c}, nil, nil))["ext--aquasecurity.github.io--v1alpha1--vulnerabilityreports"]; k.Tier != TierOnDemand {
		t.Errorf("one report per container: %+v", k)
	}
}

func TestACustomResourceKindWordNeverStealsABuiltInOne(t *testing.T) {
	// A CRD called "Service" (some service meshes) must not take the word "service" from core Services.
	c := CRD{Name: "services.mesh.example", Group: "mesh.example", Version: "v1", Plural: "services", Singular: "service", Kind: "Service", Namespaced: true}
	taken := map[string]string{"service": "services", "services": "services"}
	k := bySlug(CRDKinds([]CRD{c}, taken, nil))["ext--mesh.example--v1--services"]
	for _, a := range k.Aliases {
		if a == "service" || a == "services" {
			t.Errorf("custom kind took %q from core", a)
		}
	}
	found := false
	for _, a := range k.Aliases {
		found = found || a == "services.mesh.example"
	}
	if !found {
		t.Error("the full CRD name must still reach it")
	}
}

func TestACRDWhoseObjectsAreAlreadyCoveredIsSkipped(t *testing.T) {
	c := CRD{Name: "verticalpodautoscalers.autoscaling.k8s.io", Group: "autoscaling.k8s.io", Version: "v1", Plural: "verticalpodautoscalers", Kind: "VerticalPodAutoscaler", Namespaced: true}
	covered := map[string]bool{"autoscaling.k8s.io/v1/verticalpodautoscalers": true}
	if ks := CRDKinds([]CRD{c}, nil, covered); len(ks) != 0 {
		t.Errorf("already a built-in kind: %+v", ks)
	}
}

func TestCRDDefinitionsAreSearchableByName(t *testing.T) {
	k := CRDDefinitionsKind()
	if !k.Synthetic || k.Slug != "crds" {
		t.Fatalf("%+v", k)
	}
	got := CRDEntries([]CRD{rollouts()}, map[string]string{})
	if len(got) != 1 || got[0].Name != "rollouts.argoproj.io" || got[0].Ref != "ext--argoproj.io--v1alpha1--rollouts" || got[0].ClusterScoped {
		t.Errorf("entries = %+v", got)
	}
	// A CRD another kind already covers points at that kind.
	vpa := CRD{Name: "verticalpodautoscalers.autoscaling.k8s.io", Group: "autoscaling.k8s.io", Version: "v1", Plural: "verticalpodautoscalers", Kind: "VerticalPodAutoscaler", Namespaced: true}
	if e := CRDEntries([]CRD{vpa}, map[string]string{"autoscaling.k8s.io/v1/verticalpodautoscalers": "verticalpodautoscalers"}); e[0].Ref != "verticalpodautoscalers" {
		t.Errorf("a covered CRD should open the built-in kind: %+v", e)
	}
}

func TestAClusterScopedCustomResourceSaysSoSoTheUICanOpenIt(t *testing.T) {
	widgets := CRD{Name: "widgets.acme.example", Group: "acme.example", Version: "v1", Plural: "widgets", Kind: "Widget", Namespaced: false}
	k := bySlug(CRDKinds([]CRD{widgets, rollouts()}, nil, nil))
	if !k["ext--acme.example--v1--widgets"].ClusterScoped {
		t.Error("a cluster-scoped kind must be marked, or the UI will look for its objects in a namespace")
	}
	if k["ext--argoproj.io--v1alpha1--rollouts"].ClusterScoped {
		t.Error("rollouts are namespaced")
	}
}

// The palette recognises these words too (web/apps/shell/src/lib/paletteSearch.ts),
// so it can tell "svc api" is about Services before the engine answers. Both
// are tested against testdata/words.json. Regenerate it after changing the
// catalogue, with UPDATE_WORDS=1.
func TestTheKindWordsTheUIKnowsAreTheCataloguesOwn(t *testing.T) {
	words := map[string]string{}
	for _, k := range append(append(LocalKinds(), BuiltinKinds()...), CRDDefinitionsKind()) {
		for _, a := range k.Aliases {
			words[a] = k.Slug
		}
	}
	want, err := json.MarshalIndent(words, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want = append(want, '\n')
	if os.Getenv("UPDATE_WORDS") == "1" {
		if err := os.WriteFile("testdata/words.json", want, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile("testdata/words.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatal("testdata/words.json is out of date: run with UPDATE_WORDS=1, then the TypeScript palette test")
	}
}
