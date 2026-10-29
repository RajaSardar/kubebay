package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"helm.sh/helm/v4/pkg/action"
	releasev1 "helm.sh/helm/v4/pkg/release/v1"
	releaseutil "helm.sh/helm/v4/pkg/release/v1/util"
	"helm.sh/helm/v4/pkg/storage/driver"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/yaml"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/redact"
)

// ReleaseDetails is one release as its drawer shows it (ADR 0004 S7): its
// facts, its notes, what it created and its hooks. The objects are
// references only; nothing they hold, the release's values or its manifest
// is ever sent.
type ReleaseDetails struct {
	Release   ReleaseSummary    `json:"release"`
	Notes     string            `json:"notes,omitempty"`
	Resources []ReleaseResource `json:"resources"`
	Hooks     []ReleaseHook     `json:"hooks"`
}

// ReleaseResource is an object the release created, by reference only.
type ReleaseResource struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	// Resource is the kind's plural resource name, from the cluster's
	// discovery: how the shell links a custom resource to its page.
	Resource   string `json:"resource,omitempty"`
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name"`
	Namespaced bool   `json:"namespaced"`
	// Served is false when the cluster no longer serves its kind (a CRD
	// removed since the release was installed).
	Served bool `json:"served"`
}

// ReleaseHook is one of the release's hooks and how its last run went. Hooks
// aren't in the release's manifest, and one deleted on success leaves
// nothing in the cluster, so the release's record is where they show.
type ReleaseHook struct {
	Kind           string   `json:"kind"`
	Name           string   `json:"name"`
	Events         []string `json:"events"`
	Phase          string   `json:"phase,omitempty"`
	StartedAt      string   `json:"startedAt,omitempty"`
	CompletedAt    string   `json:"completedAt,omitempty"`
	DeletePolicies []string `json:"deletePolicies,omitempty"`
}

// HandleRelease is GET /api/helm/release?cluster&ns&name[&revision].
func (h *HelmManager) HandleRelease(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cluster, ns, name := q.Get("cluster"), q.Get("ns"), q.Get("name")
	if cluster == "" || ns == "" || name == "" {
		http.Error(w, "cluster, ns, name required", http.StatusBadRequest)
		return
	}
	cfg, err := h.cfg(r, cluster, ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	get := action.NewGet(cfg)
	if v := q.Get("revision"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			http.Error(w, "revision must be a positive number", http.StatusBadRequest)
			return
		}
		get.Version = n
	}
	rr, err := get.Run(name)
	var status apierrors.APIStatus
	switch {
	case err != nil && apierrors.IsForbidden(err) && errors.As(err, &status):
		http.Error(w, status.Status().Message, http.StatusForbidden)
		return
	case errors.Is(err, driver.ErrReleaseNotFound):
		http.Error(w, fmt.Sprintf("release %s not found in %s", name, ns), http.StatusNotFound)
		return
	case err != nil:
		http.Error(w, fmt.Sprintf("get: %v", err), http.StatusBadGateway)
		return
	}
	rel, ok := rr.(*releasev1.Release)
	if !ok || rel == nil {
		http.Error(w, "unknown release type", http.StatusBadGateway)
		return
	}
	mapper, err := h.releaseMapper(r, cluster)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out := ReleaseDetails{
		Release:   listRow(rel),
		Resources: releaseResources(rel.Manifest, rel.Namespace, mapper),
		Hooks:     releaseHooks(rel.Hooks),
	}
	if rel.Info != nil {
		out.Notes, _ = redact.String(rel.Info.Notes)
	}
	writeJSON(w, out)
}

// releaseMapper resolves kinds with the cluster's discovery, as the person
// signed in.
func (h *HelmManager) releaseMapper(r *http.Request, cluster string) (meta.RESTMapper, error) {
	if h.mapper != nil {
		return h.mapper(r, cluster)
	}
	rc, err := h.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(r.Context()))
	if err != nil {
		return nil, err
	}
	return (&releaseGetter{cfg: rc}).ToRESTMapper()
}

// releaseResources lists the objects a rendered manifest creates, in its
// order. Only each document's apiVersion, kind and metadata name and
// namespace are read. A namespaced object that names no namespace is the
// release's, as `helm install -n` puts it.
func releaseResources(manifest, releaseNS string, mapper meta.RESTMapper) []ReleaseResource {
	docs := releaseutil.SplitManifests(manifest)
	keys := make([]string, 0, len(docs))
	for k := range docs {
		keys = append(keys, k)
	}
	sort.Sort(releaseutil.BySplitManifestsOrder(keys))
	out := []ReleaseResource{}
	for _, k := range keys {
		var head struct {
			APIVersion string `json:"apiVersion"`
			Kind       string `json:"kind"`
			Metadata   struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
		}
		if err := yaml.Unmarshal([]byte(docs[k]), &head); err != nil || head.Kind == "" || head.Metadata.Name == "" {
			continue
		}
		res := ReleaseResource{APIVersion: head.APIVersion, Kind: head.Kind, Name: head.Metadata.Name, Namespaced: true, Served: true}
		gv, err := schema.ParseGroupVersion(head.APIVersion)
		if err == nil {
			m, merr := mapper.RESTMapping(gv.WithKind(head.Kind).GroupKind(), gv.Version)
			switch {
			case meta.IsNoMatchError(merr):
				res.Served = false
			case merr == nil:
				res.Namespaced = m.Scope.Name() == meta.RESTScopeNameNamespace
				res.Resource = m.Resource.Resource
			}
		}
		if res.Namespaced {
			res.Namespace = head.Metadata.Namespace
			if res.Namespace == "" {
				res.Namespace = releaseNS
			}
		}
		out = append(out, res)
	}
	return out
}

func releaseHooks(hooks []*releasev1.Hook) []ReleaseHook {
	out := []ReleaseHook{}
	stamp := func(t time.Time) string {
		if t.IsZero() {
			return ""
		}
		return t.UTC().Format(time.RFC3339)
	}
	for _, hk := range hooks {
		if hk == nil {
			continue
		}
		row := ReleaseHook{
			Kind:        hk.Kind,
			Name:        hk.Name,
			Events:      []string{},
			Phase:       string(hk.LastRun.Phase),
			StartedAt:   stamp(hk.LastRun.StartedAt),
			CompletedAt: stamp(hk.LastRun.CompletedAt),
		}
		for _, e := range hk.Events {
			row.Events = append(row.Events, string(e))
		}
		for _, p := range hk.DeletePolicies {
			row.DeletePolicies = append(row.DeletePolicies, string(p))
		}
		out = append(out, row)
	}
	return out
}
