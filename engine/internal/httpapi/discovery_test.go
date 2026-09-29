package httpapi

import (
	"reflect"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// groupVersionsFromServerGroups backs the Upgrade Readiness Panel (backlog
// #25): unlike ServerPreferredResources (used by HandleDiscovery), which
// picks exactly one version per group, ServerGroups lists every version the
// server currently serves -- the only way to tell whether a soon-to-be-removed
// apiVersion (e.g. policy/v1beta1) is still actually being served, as opposed
// to already gone.
func TestGroupVersionsFromServerGroups(t *testing.T) {
	t.Run("flattens every served version across every group, deduped and sorted", func(t *testing.T) {
		groups := []metav1.APIGroup{
			{
				Name: "policy",
				Versions: []metav1.GroupVersionForDiscovery{
					{GroupVersion: "policy/v1beta1"},
					{GroupVersion: "policy/v1"},
				},
			},
			{
				Name: "batch",
				Versions: []metav1.GroupVersionForDiscovery{
					{GroupVersion: "batch/v1"},
				},
			},
		}
		got := groupVersionsFromServerGroups(groups)
		want := []string{"batch/v1", "policy/v1", "policy/v1beta1"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v want %v", got, want)
		}
	})

	t.Run("dedupes a version listed twice", func(t *testing.T) {
		groups := []metav1.APIGroup{
			{
				Name: "batch",
				Versions: []metav1.GroupVersionForDiscovery{
					{GroupVersion: "batch/v1"},
					{GroupVersion: "batch/v1"},
				},
			},
		}
		got := groupVersionsFromServerGroups(groups)
		want := []string{"batch/v1"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v want %v", got, want)
		}
	})

	t.Run("returns an empty, non-nil slice for no groups", func(t *testing.T) {
		got := groupVersionsFromServerGroups(nil)
		if len(got) != 0 {
			t.Fatalf("got %v want empty", got)
		}
	})
}
