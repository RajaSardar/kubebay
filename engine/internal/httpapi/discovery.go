package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

type APIResourceEntry struct {
	GVR        string `json:"gvr"`
	Group      string `json:"group"`
	Version    string `json:"version"`
	Resource   string `json:"resource"`
	Kind       string `json:"kind"`
	Namespaced bool   `json:"namespaced"`
}

func (m *Metrics) HandleDiscovery(w http.ResponseWriter, r *http.Request) {
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	cfg, err := m.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(r.Context()))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	lists, err := cs.Discovery().ServerPreferredResources()
	if err != nil {
		// partial discovery is still useful
		if lists == nil {
			http.Error(w, fmt.Sprintf("discovery: %v", err), http.StatusBadGateway)
			return
		}
	}
	out := []APIResourceEntry{}
	for _, rl := range lists {
		for _, res := range rl.APIResources {
			if res.Kind == "" || contains(res.Verbs, "list") == false {
				continue
			}
			gv := rl.GroupVersion
			group, version := splitGV(gv)
			out = append(out, APIResourceEntry{
				GVR: gv + "/" + res.Name, Group: group, Version: version,
				Resource: res.Name, Kind: res.Kind, Namespaced: res.Namespaced,
			})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// HandleAPIVersions backs the Upgrade Readiness Panel (backlog #25): unlike
// HandleDiscovery's ServerPreferredResources (one version per group), this
// lists every apiVersion the server currently serves, which is the only way
// to know whether a soon-to-be-removed version (e.g. policy/v1beta1) is
// still actually being served by this cluster or already gone.
func (m *Metrics) HandleAPIVersions(w http.ResponseWriter, r *http.Request) {
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	cfg, err := m.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(r.Context()))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	groups, err := cs.Discovery().ServerGroups()
	if err != nil {
		if groups == nil {
			http.Error(w, fmt.Sprintf("discovery: %v", err), http.StatusBadGateway)
			return
		}
	}
	out := groupVersionsFromServerGroups(groups.Groups)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func groupVersionsFromServerGroups(groups []metav1.APIGroup) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, g := range groups {
		for _, v := range g.Versions {
			if seen[v.GroupVersion] {
				continue
			}
			seen[v.GroupVersion] = true
			out = append(out, v.GroupVersion)
		}
	}
	sort.Strings(out)
	return out
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func splitGV(gv string) (string, string) {
	for i := len(gv) - 1; i >= 0; i-- {
		if gv[i] == '/' {
			return gv[:i], gv[i+1:]
		}
	}
	return "", gv
}
