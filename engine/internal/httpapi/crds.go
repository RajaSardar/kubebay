package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apiextv1 "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// PrinterColumn mirrors CRD additionalPrinterColumns entries.
type PrinterColumn struct {
	Name     string `json:"name"`
	JSONPath string `json:"jsonPath"`
	Type     string `json:"type"`
}

// CRDEntry is returned by /api/crds — richer than APIResourceEntry.
type CRDEntry struct {
	Name       string          `json:"name"`        // CRD object name, e.g. "certificates.cert-manager.io"
	Group      string          `json:"group"`
	Version    string          `json:"version"`     // storage version
	Resource   string          `json:"resource"`    // plural name
	Kind       string          `json:"kind"`
	Namespaced bool            `json:"namespaced"`
	GVR        string          `json:"gvr"`
	Columns    []PrinterColumn `json:"columns"`
}

func (m *Metrics) HandleCRDs(w http.ResponseWriter, r *http.Request) {
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
	cs, err := apiextv1.NewForConfig(cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	list, err := cs.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	out := make([]CRDEntry, 0, len(list.Items))
	for _, crd := range list.Items {
		group := crd.Spec.Group
		kind := crd.Spec.Names.Kind
		plural := crd.Spec.Names.Plural
		namespaced := crd.Spec.Scope == "Namespaced"

		// Pick the storage version (fall back to first served version).
		storageVersion := ""
		columns := make([]PrinterColumn, 0)
		for _, v := range crd.Spec.Versions {
			if v.Storage {
				storageVersion = v.Name
				for _, col := range v.AdditionalPrinterColumns {
					columns = append(columns, PrinterColumn{
						Name:     col.Name,
						JSONPath: col.JSONPath,
						Type:     string(col.Type),
					})
				}
				break
			}
		}
		if storageVersion == "" && len(crd.Spec.Versions) > 0 {
			storageVersion = crd.Spec.Versions[0].Name
		}

		gvr := group + "/" + storageVersion + "/" + plural
		out = append(out, CRDEntry{
			Name:       crd.Name,
			Group:      group,
			Version:    storageVersion,
			Resource:   plural,
			Kind:       kind,
			Namespaced: namespaced,
			GVR:        gvr,
			Columns:    columns,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Group != out[j].Group {
			return out[i].Group < out[j].Group
		}
		return out[i].Kind < out[j].Kind
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
