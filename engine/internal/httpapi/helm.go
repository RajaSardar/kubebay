package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	genericclioptions "k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/yaml"

	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/chart/loader"
	"helm.sh/helm/v4/pkg/cli"
	"helm.sh/helm/v4/pkg/kube"
	ri "helm.sh/helm/v4/pkg/release"
	releasev1 "helm.sh/helm/v4/pkg/release/v1"
	"helm.sh/helm/v4/pkg/storage/driver"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// stripComplianceSpecs is a Helm PostRenderer that removes ClusterComplianceReport
// CR instances from the rendered manifest before Helm validates it against the
// cluster API. Some Trivy-Operator chart versions include compliance preset objects
// (k8s-cis-1.23, k8s-nsa-1.0, etc.) even when clusterComplianceEnabled=false.
// Their CRD is installed from crds/ first, but the Helm SDK's REST mapper cache
// doesn't refresh between CRD install and manifest validation, causing
// "resource mapping not found" errors. Stripping the instances (not the CRD) is
// safe: we set clusterComplianceEnabled=false, so the presets are unused.
type stripComplianceSpecs struct{}

func (s *stripComplianceSpecs) Run(renderedManifests *bytes.Buffer) (*bytes.Buffer, error) {
	const sep = "\n---\n"
	var out bytes.Buffer
	for _, doc := range strings.Split(renderedManifests.String(), sep) {
		if strings.TrimSpace(doc) == "" {
			continue
		}
		if strings.Contains(doc, "kind: ClusterComplianceReport") {
			continue
		}
		out.WriteString(doc)
		out.WriteString(sep)
	}
	return &out, nil
}

type HelmManager struct {
	Clusters *clusters.Manager
	Audit    *audit.Logger
}

func NewHelm(mgr *clusters.Manager, auditLog *audit.Logger) *HelmManager {
	return &HelmManager{Clusters: mgr, Audit: auditLog}
}

// helmSilentLog drops the Helm SDK's own logging, which goes to slog in Helm 4.
var helmSilentLog = slog.DiscardHandler

func (h *HelmManager) actionCfg(cluster, ns string) (*action.Configuration, error) {
	ctxName, kubeconfigPaths, err := h.Clusters.HelmEnv(cluster)
	if err != nil {
		return nil, err
	}
	cf := genericclioptions.NewConfigFlags(true)
	cf.Context = &ctxName
	// Same in-memory v1alpha1 exec upgrade the cluster manager applies, since
	// Helm reads the kubeconfig itself.
	cf.WrapConfigFn = func(c *rest.Config) *rest.Config {
		clusters.UpgradeLegacyExec(c)
		return c
	}
	if kubeconfigPaths != "" {
		p := kubeconfigPaths
		cf.KubeConfig = &p
	}
	// Helm's Kubernetes client creates the chart objects that name no namespace
	// in its own. Make that the release's, as `helm install -n` does; left
	// unset, they'd land in the kubeconfig context's namespace.
	if ns != "" {
		releaseNS := ns
		cf.Namespace = &releaseNS
	}
	cfg := action.NewConfiguration(action.ConfigurationSetLogger(helmSilentLog))
	if err := cfg.Init(cf, ns, "secrets"); err != nil {
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
	Manifest    string `json:"manifest,omitempty"`
	// ApplyMethod is how the release's objects were applied: "ssa"
	// (server-side, Helm 4's default for new installs) or "csa" (client-side,
	// every release Helm 3 wrote).
	ApplyMethod string `json:"applyMethod,omitempty"`
}

// helmUpgradeAuditDetail names the chart and version an install/upgrade
// audit entry is for -- "latest" rather than a blank field when no version
// was pinned, so the log line is never ambiguous about what "" meant.
func helmUpgradeAuditDetail(chartRef, version string) string {
	if version == "" {
		version = "latest"
	}
	return fmt.Sprintf("chart=%s version=%s", chartRef, version)
}

func summarize(rr ri.Releaser) ReleaseSummary {
	r, ok := rr.(*releasev1.Release)
	if !ok || r == nil {
		return ReleaseSummary{Status: "unknown"}
	}
	status := "unknown"
	if r.Info != nil {
		status = r.Info.Status.String()
	}
	out := ReleaseSummary{
		Name:      r.Name,
		Namespace: r.Namespace,
		Status:    status,
		Revision:  r.Version,
		Manifest:  r.Manifest,
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
	// Unset means client-side apply: Helm 3 never recorded the method.
	out.ApplyMethod = string(releasev1.ApplyMethodClientSideApply)
	if r.ApplyMethod != "" {
		out.ApplyMethod = r.ApplyMethod
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
	if r1, ok := rel.(*releasev1.Release); ok && r1 != nil {
		manifest = r1.Manifest
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
	client := helmRollback(cfg, req)
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
	client := helmUninstall(cfg)
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
	// DryRun renders the manifest client-side only -- it never contacts the
	// cluster's API server at all (Helm's --dry-run=client behavior, not
	// --dry-run=server), so a preview can never itself be the thing that
	// half-applies a broken install.
	DryRun bool `json:"dryRun,omitempty"`
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
		inst := helmInstall(cfg, req, cpo)
		rel, iErr := inst.Run(ch, vals)
		if iErr != nil {
			http.Error(w, fmt.Sprintf("install: %v", iErr), http.StatusBadGateway)
			return
		}
		if !req.DryRun {
			h.Audit.Record(audit.Entry{
				Action:    "helm-install",
				Cluster:   req.Cluster,
				Namespace: req.NS,
				Resource:  req.Name,
				Detail:    helmUpgradeAuditDetail(req.ChartRef, req.Version),
				UserAgent: r.Header.Get("User-Agent"),
			})
		}
		writeJSON(w, summarize(rel))
		return
	}
	if getErr != nil {
		http.Error(w, fmt.Sprintf("get: %v", getErr), http.StatusBadGateway)
		return
	}

	up := helmUpgrade(cfg, req, cpo)
	rel, uErr := up.Run(req.Name, ch, vals)
	if uErr != nil {
		http.Error(w, fmt.Sprintf("upgrade: %v", uErr), http.StatusBadGateway)
		return
	}
	if !req.DryRun {
		h.Audit.Record(audit.Entry{
			Action:    "helm-upgrade",
			Cluster:   req.Cluster,
			Namespace: req.NS,
			Resource:  req.Name,
			Detail:    helmUpgradeAuditDetail(req.ChartRef, req.Version),
			UserAgent: r.Header.Get("User-Agent"),
		})
	}
	writeJSON(w, summarize(rel))
}

// helmTimeout bounds every install, upgrade, rollback and uninstall.
const helmTimeout = 5 * time.Minute

// helmDryRun is a preview's strategy: rendered client-side, never sent to the
// API server.
func helmDryRun(dryRun bool) action.DryRunStrategy {
	if dryRun {
		return action.DryRunClient
	}
	return action.DryRunNone
}

// The action builders below set what Helm 4 requires or changed:
//   - a wait strategy (an action without one fails). Kubebay waits for hooks
//     only, as Helm 3 did without --wait;
//   - the apply method: Helm 4's defaults, server-side for new installs and
//     "auto" (the release's own method) for upgrades and rollbacks.

func helmInstall(cfg *action.Configuration, req HelmUpgradeRequest, cpo action.ChartPathOptions) *action.Install {
	inst := action.NewInstall(cfg)
	inst.ChartPathOptions = cpo
	inst.ReleaseName = req.Name
	inst.Namespace = req.NS
	inst.CreateNamespace = true
	inst.Timeout = helmTimeout
	inst.WaitStrategy = kube.HookOnlyStrategy
	inst.DryRunStrategy = helmDryRun(req.DryRun)
	inst.PostRenderer = &stripComplianceSpecs{}
	return inst
}

func helmUpgrade(cfg *action.Configuration, req HelmUpgradeRequest, cpo action.ChartPathOptions) *action.Upgrade {
	up := action.NewUpgrade(cfg)
	up.ChartPathOptions = cpo
	up.Namespace = req.NS
	up.Timeout = helmTimeout
	up.WaitStrategy = kube.HookOnlyStrategy
	up.DryRunStrategy = helmDryRun(req.DryRun)
	up.PostRenderer = &stripComplianceSpecs{}
	return up
}

func helmRollback(cfg *action.Configuration, req HelmActionRequest) *action.Rollback {
	rb := action.NewRollback(cfg)
	rb.Version = req.Revision
	rb.Timeout = helmTimeout
	rb.WaitStrategy = kube.HookOnlyStrategy
	return rb
}

func helmUninstall(cfg *action.Configuration) *action.Uninstall {
	un := action.NewUninstall(cfg)
	un.Timeout = helmTimeout
	un.WaitStrategy = kube.HookOnlyStrategy
	return un
}
