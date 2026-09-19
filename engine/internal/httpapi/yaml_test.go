package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

// ── splitYAMLDocs ────────────────────────────────────────────────────────────

func TestSplitYAMLDocs(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  int // expected number of docs
	}{
		{
			name:  "single doc no separator",
			input: "apiVersion: v1\nkind: Pod",
			want:  1,
		},
		{
			name:  "two docs separated by ---",
			input: "apiVersion: v1\nkind: ConfigMap\n---\napiVersion: v1\nkind: Secret",
			want:  2,
		},
		{
			name:  "three docs",
			input: "doc: one\n---\ndoc: two\n---\ndoc: three",
			want:  3,
		},
		{
			name:  "leading separator stripped",
			input: "---\napiVersion: v1\nkind: Pod",
			want:  1,
		},
		{
			name:  "blank docs between separators skipped",
			input: "doc: one\n---\n\n---\ndoc: three",
			want:  2,
		},
		{
			name:  "empty input returns empty slice",
			input: "",
			want:  0,
		},
		{
			name:  "whitespace-only input returns empty slice",
			input: "   \n\t  ",
			want:  0,
		},
		{
			name:  "separator-only input returns empty slice",
			input: "---",
			want:  0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := splitYAMLDocs(tc.input)
			if len(got) != tc.want {
				t.Errorf("splitYAMLDocs(%q) = %d docs, want %d\ngot: %q", tc.input, len(got), tc.want, got)
			}
		})
	}
}

func TestSplitYAMLDocsContent(t *testing.T) {
	// Verify the content of each split doc is trimmed and correct.
	raw := "apiVersion: v1\nkind: ConfigMap\n---\napiVersion: v1\nkind: Secret"
	docs := splitYAMLDocs(raw)
	if len(docs) != 2 {
		t.Fatalf("want 2 docs, got %d", len(docs))
	}
	if docs[0] != "apiVersion: v1\nkind: ConfigMap" {
		t.Errorf("doc[0] = %q, want ConfigMap doc", docs[0])
	}
	if docs[1] != "apiVersion: v1\nkind: Secret" {
		t.Errorf("doc[1] = %q, want Secret doc", docs[1])
	}
}

// ── resolveGVR ───────────────────────────────────────────────────────────────

// fakeDiscovery spins up a minimal httptest server that returns the given
// APIResourceList for any request — enough for resolveGVR to work without a
// real Kubernetes apiserver.
func fakeDiscovery(t *testing.T, apiVersion string, resources []metav1.APIResource) discovery.DiscoveryInterface {
	t.Helper()
	list := &metav1.APIResourceList{
		GroupVersion: apiVersion,
		APIResources: resources,
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(list)
	}))
	t.Cleanup(srv.Close)
	cfg := &rest.Config{Host: srv.URL}
	dc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		t.Fatalf("discovery client: %v", err)
	}
	return dc
}

func TestResolveGVR_CoreResource(t *testing.T) {
	dc := fakeDiscovery(t, "v1", []metav1.APIResource{
		{Name: "pods", Kind: "Pod", Namespaced: true},
		{Name: "services", Kind: "Service", Namespaced: true},
		{Name: "nodes", Kind: "Node", Namespaced: false},
	})

	gvr, namespaced, err := resolveGVR(dc, "v1", "Pod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	if gvr != want {
		t.Errorf("gvr = %v, want %v", gvr, want)
	}
	if !namespaced {
		t.Errorf("namespaced = false, want true for Pod")
	}
}

func TestResolveGVR_GroupedResource(t *testing.T) {
	dc := fakeDiscovery(t, "apps/v1", []metav1.APIResource{
		{Name: "deployments", Kind: "Deployment", Namespaced: true},
		{Name: "statefulsets", Kind: "StatefulSet", Namespaced: true},
	})

	gvr, namespaced, err := resolveGVR(dc, "apps/v1", "Deployment")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	if gvr != want {
		t.Errorf("gvr = %v, want %v", gvr, want)
	}
	if !namespaced {
		t.Errorf("namespaced = false, want true for Deployment")
	}
}

func TestResolveGVR_ClusterScoped(t *testing.T) {
	dc := fakeDiscovery(t, "v1", []metav1.APIResource{
		{Name: "nodes", Kind: "Node", Namespaced: false},
	})

	_, namespaced, err := resolveGVR(dc, "v1", "Node")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if namespaced {
		t.Errorf("namespaced = true, want false for Node")
	}
}

func TestResolveGVR_KindNotFound(t *testing.T) {
	dc := fakeDiscovery(t, "v1", []metav1.APIResource{
		{Name: "pods", Kind: "Pod", Namespaced: true},
	})

	_, _, err := resolveGVR(dc, "v1", "Nonexistent")
	if err == nil {
		t.Fatal("expected error for unknown kind, got nil")
	}
}

// ── splitYAMLDocs regression: multi-doc with trailing newlines ───────────────

func TestSplitYAMLDocs_TrailingNewline(t *testing.T) {
	// A common kubectl-generated YAML ends with a newline after the last doc.
	raw := "apiVersion: v1\nkind: Pod\nmetadata:\n  name: foo\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: bar\n"
	docs := splitYAMLDocs(raw)
	if len(docs) != 2 {
		t.Fatalf("want 2 docs, got %d: %q", len(docs), docs)
	}
}
