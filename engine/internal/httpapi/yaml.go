package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"sigs.k8s.io/yaml"

	"github.com/RajaSardar/kubebay/engine/internal/informers"
)

func (c *Channels) dynClient(ctx context.Context, cluster string) (dynamic.Interface, error) {
	cfg, err := c.Clusters.RestConfigWithIdentity(cluster, IdentityFromContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	return dynamic.NewForConfig(cfg)
}

var _ = context.Background

type ApplyYAMLRequest struct {
	Cluster   string `json:"cluster"`
	GVR       string `json:"gvr"`
	Namespace string `json:"ns"`
	Name      string `json:"name"`
	YAML      string `json:"yaml"`
	DryRun    bool   `json:"dryRun"`
	Force     bool   `json:"force"`
}

func stripNoisyFields(obj map[string]interface{}) {
	if meta, ok := obj["metadata"].(map[string]interface{}); ok {
		for _, k := range []string{"managedFields", "resourceVersion", "uid", "selfLink", "generation", "creationTimestamp"} {
			delete(meta, k)
		}
	}
}

func (c *Channels) resourceFor(ctx context.Context, cluster, gvrStr string) (dynamic.ResourceInterface, error) {
	g, err := informers.ParseGVR(gvrStr)
	if err != nil {
		return nil, err
	}
	d, err := c.dynClient(ctx, cluster)
	if err != nil {
		return nil, err
	}
	ri := d.Resource(g)
	return ri, nil
}

func (c *Channels) HandleGetYAML(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	q := r.URL.Query()
	cluster, gvr := q.Get("cluster"), q.Get("gvr")
	ns, name := q.Get("ns"), q.Get("name")
	if cluster == "" || gvr == "" || name == "" {
		http.Error(w, "cluster, gvr, name required", http.StatusBadRequest)
		return
	}
	g, err := informers.ParseGVR(gvr)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	d, err := c.dynClient(ctx, cluster)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var obj interface{}
	if ns != "" {
		obj, err = d.Resource(g).Namespace(ns).Get(ctx, name, metav1.GetOptions{})
	} else {
		obj, err = d.Resource(g).Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("get: %v", err), http.StatusBadGateway)
		return
	}
	u, ok := obj.(interface{ UnstructuredContent() map[string]interface{} })
	var doc map[string]interface{}
	if ok {
		doc = u.UnstructuredContent()
	} else {
		b, _ := json.Marshal(obj)
		_ = json.Unmarshal(b, &doc)
	}
	stripNoisyFields(doc)
	out, err := yaml.Marshal(doc)
	if err != nil {
		http.Error(w, "marshal: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	_, _ = w.Write(out)
}

func (c *Channels) HandleApplyYAML(w http.ResponseWriter, r *http.Request) {
	var req ApplyYAMLRequest
	if err := decodeBody(r, &req); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	g, err := informers.ParseGVR(req.GVR)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var doc map[string]interface{}
	if err := yaml.Unmarshal([]byte(req.YAML), &doc); err != nil {
		http.Error(w, "invalid YAML: "+err.Error(), http.StatusBadRequest)
		return
	}
	meta, _ := doc["metadata"].(map[string]interface{})
	nameFromDoc, _ := meta["name"].(string)
	if nameFromDoc != "" && req.Name != "" && nameFromDoc != req.Name {
		http.Error(w, fmt.Sprintf("metadata.name mismatch: doc=%q target=%q", nameFromDoc, req.Name), http.StatusBadRequest)
		return
	}
	if _, ok := doc["apiVersion"].(string); !ok {
		http.Error(w, "doc missing apiVersion", http.StatusBadRequest)
		return
	}
	if _, ok := doc["kind"].(string); !ok {
		http.Error(w, "doc missing kind", http.StatusBadRequest)
		return
	}

	patchOpts := metav1.PatchOptions{FieldManager: "kubebay", Force: &req.Force}
	if req.DryRun {
		patchOpts.DryRun = []string{metav1.DryRunAll}
	}

	d, err := c.dynClient(r.Context(), req.Cluster)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	data, err := yaml.YAMLToJSON([]byte(req.YAML))
	if err != nil {
		http.Error(w, "convert: "+err.Error(), http.StatusBadRequest)
		return
	}
	var applied interface{}
	ri := d.Resource(schema.GroupVersionResource(g))
	if req.Namespace != "" {
		applied, err = ri.Namespace(req.Namespace).Patch(r.Context(), req.Name, types.ApplyPatchType, data, patchOpts)
	} else {
		applied, err = ri.Patch(r.Context(), req.Name, types.ApplyPatchType, data, patchOpts)
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("apply: %v", err), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"applied": applied != nil, "dryRun": req.DryRun})
}

type CreateResourceRequest struct {
	Cluster string `json:"cluster"`
	YAML    string `json:"yaml"`
	DryRun  bool   `json:"dryRun"`
}

// resolveGVR uses server-side discovery to map apiVersion+kind → GVR + namespaced flag.
func resolveGVR(dc discovery.DiscoveryInterface, apiVersion, kind string) (schema.GroupVersionResource, bool, error) {
	resList, err := dc.ServerResourcesForGroupVersion(apiVersion)
	if err != nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("discovery for %s: %w", apiVersion, err)
	}
	var group, version string
	if idx := strings.Index(apiVersion, "/"); idx >= 0 {
		group = apiVersion[:idx]
		version = apiVersion[idx+1:]
	} else {
		version = apiVersion
	}
	for _, r := range resList.APIResources {
		if r.Kind == kind {
			return schema.GroupVersionResource{Group: group, Version: version, Resource: r.Name}, r.Namespaced, nil
		}
	}
	return schema.GroupVersionResource{}, false, fmt.Errorf("kind %q not found in %s", kind, apiVersion)
}

// splitYAMLDocs splits a multi-document YAML string on `---` boundaries,
// returning each non-empty document as a separate string.
func splitYAMLDocs(raw string) []string {
	var docs []string
	for _, part := range strings.Split(raw, "\n---") {
		trimmed := strings.TrimSpace(part)
		// Strip leading `---` left by the first split
		trimmed = strings.TrimPrefix(trimmed, "---")
		trimmed = strings.TrimSpace(trimmed)
		if trimmed != "" && trimmed != "---" {
			docs = append(docs, trimmed)
		}
	}
	if len(docs) == 0 {
		// Fallback: treat the whole thing as one doc
		if strings.TrimSpace(raw) != "" {
			docs = append(docs, strings.TrimSpace(raw))
		}
	}
	return docs
}

func (c *Channels) HandleCreateResource(w http.ResponseWriter, r *http.Request) {
	var req CreateResourceRequest
	if err := decodeBody(r, &req); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Cluster == "" || req.YAML == "" {
		http.Error(w, "cluster and yaml required", http.StatusBadRequest)
		return
	}

	cfg, err := c.Clusters.RestConfigWithIdentity(req.Cluster, IdentityFromContext(r.Context()))
	if err != nil {
		http.Error(w, "connect: "+err.Error(), http.StatusInternalServerError)
		return
	}
	dc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		http.Error(w, "discovery client: "+err.Error(), http.StatusInternalServerError)
		return
	}
	d, err := dynamic.NewForConfig(cfg)
	if err != nil {
		http.Error(w, "dynamic client: "+err.Error(), http.StatusInternalServerError)
		return
	}

	force := true
	patchOpts := metav1.PatchOptions{FieldManager: "kubebay", Force: &force}
	if req.DryRun {
		patchOpts.DryRun = []string{metav1.DryRunAll}
	}

	docs := splitYAMLDocs(req.YAML)
	applied := 0
	for i, docYAML := range docs {
		var doc map[string]interface{}
		if err := yaml.Unmarshal([]byte(docYAML), &doc); err != nil {
			http.Error(w, fmt.Sprintf("doc %d: invalid YAML: %v", i+1, err), http.StatusBadRequest)
			return
		}
		apiVersion, _ := doc["apiVersion"].(string)
		kind, _ := doc["kind"].(string)
		if apiVersion == "" || kind == "" {
			http.Error(w, fmt.Sprintf("doc %d: missing apiVersion or kind", i+1), http.StatusBadRequest)
			return
		}
		meta, _ := doc["metadata"].(map[string]interface{})
		name, _ := meta["name"].(string)
		ns, _ := meta["namespace"].(string)
		if name == "" {
			http.Error(w, fmt.Sprintf("doc %d: metadata.name is required", i+1), http.StatusBadRequest)
			return
		}
		gvr, namespaced, err := resolveGVR(dc, apiVersion, kind)
		if err != nil {
			http.Error(w, fmt.Sprintf("doc %d: resolve GVR: %v", i+1, err), http.StatusBadRequest)
			return
		}
		data, err := yaml.YAMLToJSON([]byte(docYAML))
		if err != nil {
			http.Error(w, fmt.Sprintf("doc %d: convert: %v", i+1, err), http.StatusBadRequest)
			return
		}
		ri := d.Resource(gvr)
		if namespaced && ns != "" {
			_, err = ri.Namespace(ns).Patch(r.Context(), name, types.ApplyPatchType, data, patchOpts)
		} else {
			_, err = ri.Patch(r.Context(), name, types.ApplyPatchType, data, patchOpts)
		}
		if err != nil {
			http.Error(w, fmt.Sprintf("doc %d (%s/%s): apply: %v", i+1, kind, name, err), http.StatusBadGateway)
			return
		}
		applied++
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"applied": applied, "total": len(docs), "dryRun": req.DryRun})
}
