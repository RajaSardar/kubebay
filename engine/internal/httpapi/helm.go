package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/kubernetes"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"

	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/chart/loader"
	"helm.sh/helm/v4/pkg/cli"
	"helm.sh/helm/v4/pkg/kube"
	ri "helm.sh/helm/v4/pkg/release"
	releasev1 "helm.sh/helm/v4/pkg/release/v1"
	"helm.sh/helm/v4/pkg/storage"
	"helm.sh/helm/v4/pkg/storage/driver"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/redact"
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
	// config, when set, replaces actionCfg: tests hand the handlers Helm's
	// in-memory storage.
	config func(r *http.Request, cluster, ns string) (*action.Configuration, error)
	// store, when set, replaces releaseStore for the release list.
	store func(r *http.Request, cluster, ns string) (*storage.Storage, error)
}

// cfg is the Helm action configuration a request's handler works with.
func (h *HelmManager) cfg(r *http.Request, cluster, ns string) (*action.Configuration, error) {
	if h.config != nil {
		return h.config(r, cluster, ns)
	}
	return h.actionCfg(r.Context(), cluster, ns)
}

func NewHelm(mgr *clusters.Manager, auditLog *audit.Logger) *HelmManager {
	return &HelmManager{Clusters: mgr, Audit: auditLog}
}

// helmSilentLog drops the Helm SDK's own logging, which goes to slog in Helm 4.
var helmSilentLog = slog.DiscardHandler

// actionCfg is Helm's configuration for one request: the cluster's own
// connection, as the person signed in (ADR 0004). Every other request uses
// the same config, so Helm acts with that person's RBAC (in-cluster mode
// impersonates them) and needs no kubeconfig file, which in-cluster mode
// doesn't have.
func (h *HelmManager) actionCfg(ctx context.Context, cluster, ns string) (*action.Configuration, error) {
	rc, err := h.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return nil, err
	}
	cfg := action.NewConfiguration(action.ConfigurationSetLogger(helmSilentLog))
	if err := cfg.Init(&releaseGetter{cfg: rc, ns: ns}, ns, "secrets"); err != nil {
		return nil, fmt.Errorf("helm init: %w", err)
	}
	return cfg, nil
}

// releaseGetter hands Helm a rest config instead of a kubeconfig.
type releaseGetter struct {
	cfg *rest.Config
	ns  string

	once    sync.Once
	disc    discovery.CachedDiscoveryInterface
	discErr error
}

func (g *releaseGetter) ToRESTConfig() (*rest.Config, error) { return rest.CopyConfig(g.cfg), nil }

func (g *releaseGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	g.once.Do(func() {
		c := rest.CopyConfig(g.cfg)
		// kubectl's discovery limits: a cluster with many API groups would
		// otherwise wait on the client-side rate limiter.
		c.Burst, c.QPS = 300, 50
		dc, err := discovery.NewDiscoveryClientForConfig(c)
		if err != nil {
			g.discErr = err
			return
		}
		g.disc = memory.NewMemCacheClient(dc)
	})
	return g.disc, g.discErr
}

func (g *releaseGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewShortcutExpander(restmapper.NewDeferredDiscoveryRESTMapper(dc), dc, nil), nil
}

// Helm's Kubernetes client creates the chart objects that name no namespace
// in its own. It is the release's, as `helm install -n` does; left unset,
// they'd land in "default".
func (g *releaseGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return releaseNamespace{ns: g.ns, cfg: g.cfg}
}

// releaseNamespace is the kubeconfig Helm asks for its namespace; there is
// no file behind it.
type releaseNamespace struct {
	ns  string
	cfg *rest.Config
}

func (l releaseNamespace) RawConfig() (clientcmdapi.Config, error) {
	return *clientcmdapi.NewConfig(), nil
}

func (l releaseNamespace) ConfigAccess() clientcmd.ConfigAccess {
	return clientcmd.NewDefaultClientConfig(*clientcmdapi.NewConfig(), &clientcmd.ConfigOverrides{}).ConfigAccess()
}

func (l releaseNamespace) Namespace() (string, bool, error) {
	if l.ns == "" {
		return "default", false, nil
	}
	return l.ns, true, nil
}

func (l releaseNamespace) ClientConfig() (*rest.Config, error) { return rest.CopyConfig(l.cfg), nil }

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

// listRow is a release as a list or history shows it: no manifest, which can
// hold rendered Secrets and which no list needs (ADR 0004).
func listRow(rr ri.Releaser) ReleaseSummary {
	row := summarize(rr)
	row.Manifest = ""
	return row
}

func (h *HelmManager) HandleReleases(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cluster := q.Get("cluster")
	// Named namespaces, for an identity that can't read release Secrets
	// cluster-wide; none = the whole cluster.
	scopes := uniqueStrings(q["ns"])
	if len(scopes) == 0 {
		scopes = []string{""}
	}
	out := releaseList{Releases: []ReleaseSummary{}, Denied: []namespaceRefusal{}}
	for _, ns := range scopes {
		store, err := h.releaseStore(r, cluster, ns)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		rels, err := store.ListReleases()
		var status apierrors.APIStatus
		if err != nil && ns != "" && apierrors.IsForbidden(err) && errors.As(err, &status) {
			out.Denied = append(out.Denied, namespaceRefusal{NS: ns, Message: status.Status().Message})
			continue
		}
		if err != nil {
			http.Error(w, fmt.Sprintf("list: %v", err), http.StatusBadGateway)
			return
		}
		out.Releases = append(out.Releases, newestRows(rels)...)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func uniqueStrings(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func (h *HelmManager) HandleHistory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cfg, err := h.cfg(r, q.Get("cluster"), q.Get("ns"))
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
		out = append(out, listRow(rel))
	}
	// Newest first: storage returns them in the API server's order, which
	// sorts revision names as text (v1, v10, v2…).
	sort.Slice(out, func(i, j int) bool { return out[i].Revision > out[j].Revision })
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *HelmManager) HandleValues(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cfg, err := h.cfg(r, q.Get("cluster"), q.Get("ns"))
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
	cfg, err := h.cfg(r, q.Get("cluster"), q.Get("ns"))
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
	_, _ = w.Write([]byte(maskSecretValues(manifest)))
}

var (
	manifestDocSep  = regexp.MustCompile(`(?m)^---[ \t]*$`)
	looksLikeSecret = regexp.MustCompile(`(?m)^kind:\s*["']?Secret["']?\s*$`)
)

// maskSecretValues returns a rendered manifest with every Secret's data and
// stringData values masked; their keys, and every other document, stay as
// they are.
func maskSecretValues(manifest string) string {
	var b strings.Builder
	prev := 0
	for _, loc := range manifestDocSep.FindAllStringIndex(manifest, -1) {
		b.WriteString(maskSecretDoc(manifest[prev:loc[0]]))
		b.WriteString(manifest[loc[0]:loc[1]])
		prev = loc[1]
	}
	b.WriteString(maskSecretDoc(manifest[prev:]))
	return b.String()
}

func maskSecretDoc(doc string) string {
	if !looksLikeSecret.MatchString(doc) {
		return doc
	}
	// Keep the blank lines and "# Source:" comments before the object.
	lead := 0
	for lead < len(doc) {
		end := strings.IndexByte(doc[lead:], '\n')
		if end < 0 {
			break
		}
		line := strings.TrimSpace(doc[lead : lead+end])
		if line != "" && !strings.HasPrefix(line, "#") {
			break
		}
		lead += end + 1
	}
	var obj map[string]any
	if err := yaml.Unmarshal([]byte(doc), &obj); err != nil {
		return doc[:lead] + "# A Secret is not shown: it could not be read to mask its values.\n"
	}
	for _, field := range []string{"data", "stringData"} {
		if values, ok := obj[field].(map[string]any); ok {
			for k := range values {
				values[k] = redact.Mask
			}
		}
	}
	out, err := yaml.Marshal(obj)
	if err != nil {
		return doc[:lead] + "# A Secret is not shown: it could not be read to mask its values.\n"
	}
	return doc[:lead] + string(out)
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
	cfg, err := h.cfg(r, req.Cluster, req.NS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client := helmRollback(cfg, req)
	if err := client.Run(req.Name); err != nil {
		http.Error(w, fmt.Sprintf("rollback: %v", err), http.StatusBadGateway)
		return
	}
	h.Audit.Record(audit.Entry{
		Action:    "helm-rollback",
		Cluster:   req.Cluster,
		Namespace: req.NS,
		Resource:  req.Name,
		Detail:    fmt.Sprintf("revision=%d", req.Revision),
		UserAgent: r.Header.Get("User-Agent"),
	})
	writeJSON(w, map[string]bool{"ok": true})
}

func (h *HelmManager) HandleUninstall(w http.ResponseWriter, r *http.Request) {
	var req HelmActionRequest
	if err := decodeBody(r, &req); err != nil || req.Cluster == "" || req.Name == "" || req.NS == "" {
		http.Error(w, "cluster, ns, name required", http.StatusBadRequest)
		return
	}
	cfg, err := h.cfg(r, req.Cluster, req.NS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client := helmUninstall(cfg)
	if _, err := client.Run(req.Name); err != nil {
		http.Error(w, fmt.Sprintf("uninstall: %v", err), http.StatusBadGateway)
		return
	}
	h.Audit.Record(audit.Entry{
		Action:    "helm-uninstall",
		Cluster:   req.Cluster,
		Namespace: req.NS,
		Resource:  req.Name,
		UserAgent: r.Header.Get("User-Agent"),
	})
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
	cfg, err := h.cfg(r, req.Cluster, req.NS)
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
	// As many revisions as the helm CLI keeps; unlimited, every upgrade
	// added a Secret that listing then had to fetch.
	up.MaxHistory = 10
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

// liveReleaseStore is Helm's storage over the given release Secrets, listing
// only the revisions Helm hasn't marked superseded (ADR 0004). Helm decodes
// every Secret a list returns and then keeps each release's newest revision;
// a superseded one is never the newest (Helm relabels a revision in the same
// update that supersedes it), so the API server can leave them out. Failed
// revisions stay, and Helm still picks the newest.
func liveReleaseStore(secrets corev1client.SecretInterface) *storage.Storage {
	return storage.Init(driver.NewSecrets(liveRevisions{secrets}))
}

type liveRevisions struct{ corev1client.SecretInterface }

func (l liveRevisions) List(ctx context.Context, opts metav1.ListOptions) (*corev1.SecretList, error) {
	if opts.LabelSelector != "" {
		opts.LabelSelector += ","
	}
	opts.LabelSelector += "status!=superseded"
	return l.SecretInterface.List(ctx, opts)
}

// releaseStore is Helm's storage over the live release Secrets of one
// namespace ("" = every namespace), read as the person signed in.
func (h *HelmManager) releaseStore(r *http.Request, cluster, ns string) (*storage.Storage, error) {
	if h.store != nil {
		return h.store(r, cluster, ns)
	}
	rc, err := h.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(r.Context()))
	if err != nil {
		return nil, err
	}
	cs, err := kubernetes.NewForConfig(rc)
	if err != nil {
		return nil, err
	}
	return liveReleaseStore(cs.CoreV1().Secrets(ns)), nil
}

// newestRows keeps each release's newest revision, as helm list does.
func newestRows(rels []ri.Releaser) []ReleaseSummary {
	newest := map[string]*releasev1.Release{}
	for _, rr := range rels {
		r, ok := rr.(*releasev1.Release)
		if !ok || r == nil {
			continue
		}
		k := r.Namespace + "/" + r.Name
		if cur := newest[k]; cur == nil || r.Version > cur.Version {
			newest[k] = r
		}
	}
	out := make([]ReleaseSummary, 0, len(newest))
	for _, r := range newest {
		out = append(out, listRow(r))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Namespace+"/"+out[i].Name < out[j].Namespace+"/"+out[j].Name })
	return out
}

// releaseList is the Helm page's list: the releases, and the named
// namespaces RBAC refused (ADR 0003, ADR 0004).
type releaseList struct {
	Releases []ReleaseSummary   `json:"releases"`
	Denied   []namespaceRefusal `json:"denied"`
}

type namespaceRefusal struct {
	NS      string `json:"ns"`
	Message string `json:"message"`
}
