package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

type PodUsage struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	CPUMillis int64  `json:"cpuMillis"`
	MemBytes  int64  `json:"memBytes"`
}

type Metrics struct {
	Clusters *clusters.Manager
}

func (m *Metrics) HandlePodMetrics(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cluster := q.Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	ns := q.Get("ns")

	cfg, err := restConfigFor(r.Context(), m.Clusters, cluster)
	if err != nil {
		http.Error(w, fmt.Sprintf("connect: %v", err), http.StatusInternalServerError)
		return
	}
	mc, err := metricsv.NewForConfig(cfg)
	if err != nil {
		http.Error(w, fmt.Sprintf("client: %v", err), http.StatusInternalServerError)
		return
	}

	var list *metricsv1beta1.PodMetricsList
	if ns != "" && ns != "*" {
		list, err = mc.MetricsV1beta1().PodMetricses(ns).List(r.Context(), metav1.ListOptions{})
	} else {
		list, err = mc.MetricsV1beta1().PodMetricses(metav1.NamespaceAll).List(r.Context(), metav1.ListOptions{})
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("metrics API: %v", err), http.StatusBadGateway)
		return
	}

	out := make([]PodUsage, 0, len(list.Items))
	for _, p := range list.Items {
		var cpuMillis, memBytes int64
		for _, ctr := range p.Containers {
			cpuMillis += ctr.Usage.Cpu().MilliValue()
			memBytes += ctr.Usage.Memory().Value()
		}
		out = append(out, PodUsage{
			Namespace: p.Namespace,
			Name:      p.Name,
			CPUMillis: cpuMillis,
			MemBytes:  memBytes,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (m *Metrics) HandleNodeMetrics(w http.ResponseWriter, r *http.Request) {
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	cfg, err := m.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(r.Context()))
	if err != nil {
		http.Error(w, fmt.Sprintf("connect: %v", err), http.StatusInternalServerError)
		return
	}
	mc, err := metricsv.NewForConfig(cfg)
	if err != nil {
		http.Error(w, fmt.Sprintf("client: %v", err), http.StatusInternalServerError)
		return
	}
	list, err := mc.MetricsV1beta1().NodeMetricses().List(r.Context(), metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("metrics API: %v", err), http.StatusBadGateway)
		return
	}
	type nodeUsage struct {
		Name      string `json:"name"`
		CPUMillis int64  `json:"cpuMillis"`
		MemBytes  int64  `json:"memBytes"`
	}
	out := make([]nodeUsage, 0, len(list.Items))
	for _, n := range list.Items {
		var cpuMillis, memBytes int64
		cpuMillis += n.Usage.Cpu().MilliValue()
		memBytes += n.Usage.Memory().Value()
		out = append(out, nodeUsage{Name: n.Name, CPUMillis: cpuMillis, MemBytes: memBytes})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
