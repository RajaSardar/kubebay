package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
)

// argoCDApp is the response shape for a single ArgoCD Application.
type argoCDApp struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	Project        string `json:"project"`
	RepoURL        string `json:"repoURL"`
	TargetRevision string `json:"targetRevision"`
	SyncStatus     string `json:"syncStatus"`
	HealthStatus   string `json:"healthStatus"`
	LastSyncTime   string `json:"lastSyncTime"`
	Message        string `json:"message"`
}

// argoCDAppsResponse wraps the list with an installed indicator.
type argoCDAppsResponse struct {
	Installed bool        `json:"installed"`
	Apps      []argoCDApp `json:"apps"`
}

var argoCDAppGVR = schema.GroupVersionResource{
	Group:    "argoproj.io",
	Version:  "v1alpha1",
	Resource: "applications",
}

// argoCDAppsHandler handles GET /api/argocd/apps?cluster=<id>
// Lists ArgoCD Applications and returns sync/health status.
// Returns { installed: false, apps: [] } when ArgoCD is not installed.
func argoCDAppsHandler(m *Metrics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cluster := r.URL.Query().Get("cluster")
		if cluster == "" {
			http.Error(w, "cluster required", http.StatusBadRequest)
			return
		}

		cfg, err := restConfigFor(r.Context(), m.Clusters, cluster)
		if err != nil {
			http.Error(w, fmt.Sprintf("connect: %v", err), http.StatusInternalServerError)
			return
		}

		dyn, err := dynamic.NewForConfig(cfg)
		if err != nil {
			http.Error(w, fmt.Sprintf("client: %v", err), http.StatusInternalServerError)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()

		list, err := dyn.Resource(argoCDAppGVR).Namespace(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
		if err != nil {
			if apierrors.IsNotFound(err) || argoCDNotInstalled(err) {
				writeJSON(w, argoCDAppsResponse{Installed: false, Apps: []argoCDApp{}})
				return
			}
			http.Error(w, fmt.Sprintf("list: %v", err), http.StatusBadGateway)
			return
		}

		apps := make([]argoCDApp, 0, len(list.Items))
		for _, item := range list.Items {
			obj := item.Object
			app := argoCDApp{
				Name:      argoCDStr(obj, "metadata", "name"),
				Namespace: argoCDStr(obj, "metadata", "namespace"),
			}

			// spec
			if spec, ok := obj["spec"].(map[string]interface{}); ok {
				app.Project, _ = spec["project"].(string)
				if src, ok := spec["source"].(map[string]interface{}); ok {
					app.RepoURL, _ = src["repoURL"].(string)
					app.TargetRevision, _ = src["targetRevision"].(string)
				}
			}

			// status
			if status, ok := obj["status"].(map[string]interface{}); ok {
				if sync, ok := status["sync"].(map[string]interface{}); ok {
					app.SyncStatus, _ = sync["status"].(string)
				}
				if health, ok := status["health"].(map[string]interface{}); ok {
					app.HealthStatus, _ = health["status"].(string)
				}
				if opState, ok := status["operationState"].(map[string]interface{}); ok {
					app.LastSyncTime, _ = opState["finishedAt"].(string)
					app.Message, _ = opState["message"].(string)
				}
				// fallback timestamp
				if app.LastSyncTime == "" {
					app.LastSyncTime, _ = status["reconciledAt"].(string)
				}
			}

			apps = append(apps, app)
		}

		writeJSON(w, argoCDAppsResponse{Installed: true, Apps: apps})
	}
}

// argoCDSyncHandler handles POST /api/argocd/sync
// Triggers a hard refresh by patching the refresh annotation.
func argoCDSyncHandler(m *Metrics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Cluster   string `json:"cluster"`
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
		}
		if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.Name == "" {
			http.Error(w, "cluster, name required", http.StatusBadRequest)
			return
		}
		if body.Namespace == "" {
			body.Namespace = "argocd"
		}

		cfg, err := restConfigFor(r.Context(), m.Clusters, body.Cluster)
		if err != nil {
			http.Error(w, fmt.Sprintf("connect: %v", err), http.StatusInternalServerError)
			return
		}
		dyn, err := dynamic.NewForConfig(cfg)
		if err != nil {
			http.Error(w, fmt.Sprintf("client: %v", err), http.StatusInternalServerError)
			return
		}

		patch := []byte(`{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}`)
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()

		_, err = dyn.Resource(argoCDAppGVR).Namespace(body.Namespace).Patch(
			ctx, body.Name, types.MergePatchType, patch, metav1.PatchOptions{},
		)
		if err != nil {
			http.Error(w, fmt.Sprintf("patch: %v", err), http.StatusBadGateway)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

// argoCDNotInstalled returns true when the dynamic client error indicates the
// ArgoCD CRD is not registered in the cluster.
func argoCDNotInstalled(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, needle := range []string{
		"no matches for kind",
		"no kind is registered",
		"the server could not find the requested resource",
		"resource not found",
	} {
		if strContains(msg, needle) {
			return true
		}
	}
	return false
}

// strContains is a simple substring check used instead of strings.Contains
// so we avoid adding a new import that might conflict.
func strContains(s, sub string) bool {
	if len(sub) == 0 {
		return true
	}
	if len(s) < len(sub) {
		return false
	}
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// argoCDStr traverses a nested map to return a string field.
func argoCDStr(obj map[string]interface{}, keys ...string) string {
	cur := obj
	for i, k := range keys {
		if i == len(keys)-1 {
			v, _ := cur[k].(string)
			return v
		}
		next, _ := cur[k].(map[string]interface{})
		if next == nil {
			return ""
		}
		cur = next
	}
	return ""
}
