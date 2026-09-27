package httpapi

import (
	"strings"
	"testing"
)

func TestGitopsOwnerFromDoc(t *testing.T) {
	cases := []struct {
		name string
		doc  map[string]interface{}
		want string
	}{
		{
			name: "no metadata",
			doc:  map[string]interface{}{},
			want: "",
		},
		{
			name: "no annotations",
			doc:  map[string]interface{}{"metadata": map[string]interface{}{}},
			want: "",
		},
		{
			name: "no GitOps annotations",
			doc: map[string]interface{}{
				"metadata": map[string]interface{}{"annotations": map[string]interface{}{}},
			},
			want: "",
		},
		{
			name: "Argo CD via instance annotation",
			doc: map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": map[string]interface{}{"argocd.argoproj.io/instance": "my-app"},
				},
			},
			want: "argocd:my-app",
		},
		{
			name: "Argo CD via tracking-id, app name before first colon",
			doc: map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": map[string]interface{}{
						"argocd.argoproj.io/tracking-id": "my-app:apps/Deployment:default/my-deploy",
					},
				},
			},
			want: "argocd:my-app",
		},
		{
			name: "instance preferred over tracking-id",
			doc: map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": map[string]interface{}{
						"argocd.argoproj.io/instance":    "instance-app",
						"argocd.argoproj.io/tracking-id": "tracking-app:apps/Deployment:default/my-deploy",
					},
				},
			},
			want: "argocd:instance-app",
		},
		{
			name: "Flux via Kustomization name",
			doc: map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": map[string]interface{}{"kustomize.toolkit.fluxcd.io/name": "my-kustomization"},
				},
			},
			want: "flux:my-kustomization",
		},
		{
			name: "Flux via HelmRelease name",
			doc: map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": map[string]interface{}{"helm.toolkit.fluxcd.io/name": "my-release"},
				},
			},
			want: "flux:my-release",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := gitopsOwnerFromDoc(tc.doc)
			if got != tc.want {
				t.Errorf("gitopsOwnerFromDoc(%+v) = %q, want %q", tc.doc, got, tc.want)
			}
		})
	}
}

func TestAppendOwnerDetail(t *testing.T) {
	if got := appendOwnerDetail("gvr=v1/pods", ""); got != "gvr=v1/pods" {
		t.Errorf("empty owner should leave detail unchanged, got %q", got)
	}
	if got := appendOwnerDetail("gvr=v1/pods", "argocd:my-app"); got != "gvr=v1/pods owner=argocd:my-app" {
		t.Errorf("got %q", got)
	}
	// A client-supplied owner string is informational only (audit context, not a
	// security decision) but must not be able to blow out the audit log.
	huge := strings.Repeat("x", 1000)
	got := appendOwnerDetail("gvr=v1/pods", huge)
	if len(got) > len("gvr=v1/pods owner=")+ownerDetailMaxLen {
		t.Errorf("owner detail was not capped: len=%d", len(got))
	}
}
