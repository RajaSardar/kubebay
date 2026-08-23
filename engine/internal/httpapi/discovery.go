package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"

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
