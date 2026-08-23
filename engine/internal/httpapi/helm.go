package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	genericclioptions "k8s.io/cli-runtime/pkg/genericclioptions"
	"sigs.k8s.io/yaml"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/storage/driver"
	"helm.sh/helm/v3/pkg/release"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

type HelmManager struct {
	Clusters *clusters.Manager
}

func NewHelm(mgr *clusters.Manager) *HelmManager { return &HelmManager{Clusters: mgr} }

var helmSilentLog = func(_ string, _ ...interface{}) {}

func (h *HelmManager) actionCfg(cluster, ns string) (*action.Configuration, error) {
	ctxName, kubeconfigPaths, err := h.Clusters.HelmEnv(cluster)
	if err != nil {
		return nil, err
	}
	cf := genericclioptions.NewConfigFlags(true)
	cf.Context = &ctxName
	if kubeconfigPaths != "" {
		p := kubeconfigPaths
		cf.KubeConfig = &p
	}
	cfg := new(action.Configuration)
	if err := cfg.Init(cf, ns, "secrets", helmSilentLog); err != nil {
		return nil, fmt.Errorf("helm init: %w", err)
	}
	return cfg, nil
}

func (h *HelmManager) settings() *cli.EnvSettings {
	s := cli.New()
	s.SetNamespace("")
	return s
}

type ReleaseSummary struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Chart       string `json:"chart"`
	ChartVer    string `json:"chartVersion"`
	AppVersion  string `json:"appVersion,omitempty"`
	Status      string `json:"status"`
	Revision    int    `json:"revision"`
	Updated     string `json:"updated,omitempty"`
	Description string `json:"description,omitempty"`
}

func summarize(r *release.Release) ReleaseSummary {
	out := ReleaseSummary{
		Name:      r.Name,
		Namespace: r.Namespace,
		Status:    r.Info.Status.String(),
		Revision:  r.Version,
	}
	if r.Chart != nil && r.Chart.Metadata != nil {
		out.Chart = r.Chart.Metadata.Name
		out.ChartVer = r.Chart.Metadata.Version
		out.AppVersion = r.Chart.Metadata.AppVersion
	}
	if r.Info != nil && !r.Info.LastDeployed.IsZero() {
		out.Updated = r.Info.LastDeployed.UTC().Format(time.RFC3339)
	}
	if r.Info != nil {
		out.Description = r.Info.Description
	}
	return out
}

func (h *HelmManager) HandleReleases(w http.ResponseWriter, r *http.Request) {
	cluster := r.URL.Query().Get("cluster")
	cfg, err := h.actionCfg(cluster, "")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client := action.NewList(cfg)
	client.AllNamespaces = true
	client.StateMask = action.ListAll
	rels, err := client.Run()
	if err != nil {
		http.Error(w, fmt.Sprintf("list: %v", err), http.StatusBadGateway)
		return
	}
	out := make([]ReleaseSummary, 0, len(rels))
	for _, rel := range rels {
		out = append(out, summarize(rel))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *HelmManager) HandleHistory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cfg, err := h.actionCfg(q.Get("cluster"), q.Get("ns"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client := action.NewHistory(cfg)
	rels, err := client.Run(q.Get("name"))
	if err != nil {
		http.Error(w, fmt.Sprintf("history: %v", err), http.StatusBadGateway)
		return
	}
	out := make([]ReleaseSummary, 0, len(rels))
	for _, rel := range rels {
		out = append(out, summarize(rel))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *HelmManager) HandleValues(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cfg, err := h.actionCfg(q.Get("cluster"), q.Get("ns"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client := action.NewGetValues(cfg)
	vals, err := client.Run(q.Get("name"))
	if err != nil {
		http.Error(w, fmt.Sprintf("values: %v", err), http.StatusBadGateway)
		return
	}
	out, err := yaml.Marshal(vals)
	if err != nil {
		http.Error(w, "marshal: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	_, _ = w.Write(out)
}

func (h *HelmManager) HandleManifest(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cfg, err := h.actionCfg(q.Get("cluster"), q.Get("ns"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client := action.NewGet(cfg)
	rel, err := client.Run(q.Get("name"))
	if err != nil {
		http.Error(w, fmt.Sprintf("manifest: %v", err), http.StatusBadGateway)
		return
	}
	manifest := ""
	if rel != nil {
		manifest = rel.Manifest
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(manifest))
}

type HelmActionRequest struct {
	Cluster  string `json:"cluster"`
	NS       string `json:"ns"`
	Name     string `json:"name"`
	Revision int    `json:"revision,omitempty"`
}

func (h *HelmManager) HandleRollback(w http.ResponseWriter, r *http.Request) {
	var req HelmActionRequest
	if err := decodeBody(r, &req); err != nil || req.Cluster == "" || req.Name == "" || req.NS == "" {
		http.Error(w, "cluster, ns, name required", http.StatusBadRequest)
		return
	}
	cfg, err := h.actionCfg(req.Cluster, req.NS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client := action.NewRollback(cfg)
	client.Version = req.Revision
	client.Timeout = 5 * time.Minute
	ctx, cancel := context.WithTimeout(r.Context(), client.Timeout+30*time.Second)
	defer cancel()
	_ = ctx
	if err := client.Run(req.Name); err != nil {
		_ = ctx
		http.Error(w, fmt.Sprintf("rollback: %v", err), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (h *HelmManager) HandleUninstall(w http.ResponseWriter, r *http.Request) {
	var req HelmActionRequest
	if err := decodeBody(r, &req); err != nil || req.Cluster == "" || req.Name == "" || req.NS == "" {
		http.Error(w, "cluster, ns, name required", http.StatusBadRequest)
		return
	}
	cfg, err := h.actionCfg(req.Cluster, req.NS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client := action.NewUninstall(cfg)
	client.Timeout = 5 * time.Minute
	ctx, cancel := context.WithTimeout(r.Context(), client.Timeout+30*time.Second)
	defer cancel()
	out, uerr := client.Run(req.Name)
	if uerr != nil {
		_ = out
		_ = ctx
		http.Error(w, fmt.Sprintf("uninstall: %v", uerr), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

type HelmUpgradeRequest struct {
	Cluster    string `json:"cluster"`
	NS         string `json:"ns"`
	Name       string `json:"name"`
	ChartRef   string `json:"chartRef"`
	Version    string `json:"version,omitempty"`
	ValuesYAML string `json:"valuesYaml"`
}

func (h *HelmManager) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	var req HelmUpgradeRequest
	if err := decodeBody(r, &req); err != nil || req.Cluster == "" || req.Name == "" || req.NS == "" || req.ChartRef == "" {
		http.Error(w, "cluster, ns, name, chartRef required", http.StatusBadRequest)
		return
	}
	cfg, err := h.actionCfg(req.Cluster, req.NS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	settings := h.settings()
	cpo := action.ChartPathOptions{Version: req.Version}
	chartPath, err := cpo.LocateChart(req.ChartRef, settings)
	if err != nil {
		http.Error(w, fmt.Sprintf("locate chart: %v", err), http.StatusBadGateway)
		return
	}
	ch, err := loader.Load(chartPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("load chart: %v", err), http.StatusBadGateway)
		return
	}
	vals := map[string]interface{}{}
	if req.ValuesYAML != "" {
		var jsonVals map[string]interface{}
		if err := yaml.Unmarshal([]byte(req.ValuesYAML), &jsonVals); err != nil {
			http.Error(w, "invalid values YAML: "+err.Error(), http.StatusBadRequest)
			return
		}
		vals = jsonVals
	}

	get := action.NewGet(cfg)
	_, getErr := get.Run(req.Name)

	if errors.Is(getErr, driver.ErrReleaseNotFound) || (getErr != nil && strings.Contains(strings.ToLower(getErr.Error()), "not found")) {
		inst := action.NewInstall(cfg)
		inst.ChartPathOptions = cpo
		inst.ReleaseName = req.Name
		inst.Namespace = req.NS
		inst.CreateNamespace = true
		inst.Timeout = 5 * time.Minute
		rel, iErr := inst.Run(ch, vals)
		if iErr != nil {
			http.Error(w, fmt.Sprintf("install: %v", iErr), http.StatusBadGateway)
			return
		}
		writeJSON(w, summarize(rel))
		return
	}
	if getErr != nil {
		http.Error(w, fmt.Sprintf("get: %v", getErr), http.StatusBadGateway)
		return
	}

	up := action.NewUpgrade(cfg)
	up.ChartPathOptions = cpo
	up.Namespace = req.NS
	up.Timeout = 5 * time.Minute
	rel, uErr := up.Run(req.Name, ch, vals)
	if uErr != nil {
		http.Error(w, fmt.Sprintf("upgrade: %v", uErr), http.StatusBadGateway)
		return
	}
	writeJSON(w, summarize(rel))
}
