package httpapi

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clouddiscovery"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// DiscoveryAPI finds EKS, GKE and AKS clusters the user's own aws, gcloud and
// az CLIs can see and imports one into a Kubebay-owned kubeconfig (backlog
// #14). Nothing runs until the user asks, and the user's own kubeconfig is
// never written.
type DiscoveryAPI struct {
	Settings *SettingsManager
	Clusters *clusters.Manager
	// Run runs the aws, gcloud or az CLI (nil = os/exec on the user's PATH).
	Run clouddiscovery.Runner
	// Disabled, when set, is why discovery is off.
	Disabled string
}

// DiscoveryBlockReason: discovery runs the aws CLI with the engine host's
// credentials, which in server mode belong to no logged-in user.
func DiscoveryBlockReason(inCluster, oidcEnabled bool) string {
	switch {
	case oidcEnabled:
		return "cluster discovery runs the cloud CLIs with the engine host's own credentials, so it is off when OIDC is configured"
	case inCluster:
		return "cluster discovery runs the cloud CLIs with the engine host's own credentials, so it is off in in-cluster mode"
	}
	return ""
}

func (d *DiscoveryAPI) run() clouddiscovery.Runner {
	if d.Run != nil {
		return d.Run
	}
	return func(ctx context.Context, name string, args ...string) ([]byte, error) {
		return execRunner(ctx, name, args...)
	}
}

func (d *DiscoveryAPI) blocked(w http.ResponseWriter) bool {
	if d.Disabled != "" {
		http.Error(w, d.Disabled, http.StatusForbidden)
		return true
	}
	return false
}

// knownContexts are the context names every loaded kubeconfig already has.
func (d *DiscoveryAPI) knownContexts() map[string]bool {
	known := map[string]bool{}
	for _, c := range d.Clusters.List() {
		known[c.Context] = true
	}
	return known
}

// HandleProfiles lists the AWS CLI's profiles with their default regions.
func (d *DiscoveryAPI) HandleProfiles(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	profiles, err := clouddiscovery.Profiles(ctx, d.run())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if profiles == nil {
		profiles = []clouddiscovery.Profile{}
	}
	writeJSON(w, profiles)
}

type discoveredCluster struct {
	clouddiscovery.EKSCluster
	// Imported: a loaded kubeconfig already has this cluster's ARN context.
	Imported bool `json:"imported"`
}

// HandleScan lists and describes the EKS clusters in the chosen regions.
func (d *DiscoveryAPI) HandleScan(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	var body struct {
		Profile string   `json:"profile"`
		Regions []string `json:"regions"`
	}
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(body.Regions) == 0 || len(body.Regions) > 40 {
		http.Error(w, "choose between 1 and 40 regions", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	res := clouddiscovery.ScanEKS(ctx, d.run(), body.Profile, body.Regions)
	known := d.knownContexts()
	out := make([]discoveredCluster, 0, len(res.Clusters))
	for _, c := range res.Clusters {
		out = append(out, discoveredCluster{EKSCluster: c, Imported: known[c.Arn]})
	}
	writeJSON(w, map[string]any{"clusters": out, "errors": res.Errors})
}

// HandleImport describes the cluster again (never trusting an endpoint or CA
// from the browser), writes a one-cluster kubeconfig under
// ~/.kubebay/discovered, and adds it to the extra kubeconfigs.
func (d *DiscoveryAPI) HandleImport(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	var body struct {
		Profile string `json:"profile"`
		Region  string `json:"region"`
		Name    string `json:"name"`
	}
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if !clouddiscovery.ValidProfile(body.Profile) || !clouddiscovery.ValidRegion(body.Region) || !clouddiscovery.ValidClusterName(body.Name) {
		http.Error(w, "invalid profile, region or cluster name", http.StatusBadRequest)
		return
	}
	if pinned := d.Clusters.ExplicitKubeconfig(); pinned != "" {
		http.Error(w, fmt.Sprintf("Kubebay was started with one dedicated kubeconfig (%s) and loads nothing else; add this cluster to that file instead: aws eks update-kubeconfig --name %s --region %s --kubeconfig %s", pinned, body.Name, body.Region, pinned), http.StatusConflict)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	c, err := clouddiscovery.DescribeEKS(ctx, d.run(), body.Profile, body.Region, body.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if d.knownContexts()[c.Arn] {
		http.Error(w, fmt.Sprintf("%s is already in a loaded kubeconfig", c.Arn), http.StatusConflict)
		return
	}
	kc, err := clouddiscovery.Kubeconfig(c, body.Profile)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	path, err := d.writeDiscovered(clouddiscovery.FileName(c, body.Profile), kc)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"path": path, "context": c.Arn})
}

// writeDiscovered writes one imported cluster's kubeconfig atomically under
// ~/.kubebay/discovered (0600, directory 0700) and adds it to the extra
// kubeconfigs, keeping every other setting.
func (d *DiscoveryAPI) writeDiscovered(file string, kc []byte) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, settingsDir, "discovered")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, file)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, kc, 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return path, d.Settings.AddExtraKubeconfig(path)
}

// HandleGCPProjects lists the projects the signed-in gcloud account can see.
func (d *DiscoveryAPI) HandleGCPProjects(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	projects, err := clouddiscovery.GCPProjects(ctx, d.run())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, projects)
}

type discoveredGKE struct {
	clouddiscovery.GKECluster
	// Imported: a loaded kubeconfig already has this cluster's gke_ context.
	Imported bool `json:"imported"`
}

// HandleGKEScan lists one project's GKE clusters in every location.
func (d *DiscoveryAPI) HandleGKEScan(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	var body struct {
		Project string `json:"project"`
	}
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	res := clouddiscovery.ScanGKE(ctx, d.run(), body.Project)
	known := d.knownContexts()
	out := make([]discoveredGKE, 0, len(res.Clusters))
	for _, c := range res.Clusters {
		out = append(out, discoveredGKE{GKECluster: c, Imported: known[c.Context]})
	}
	writeJSON(w, map[string]any{"clusters": out, "errors": res.Errors})
}

// HandleGKEImport describes the cluster again (never trusting an endpoint or
// CA from the browser) and imports it with a gke-gcloud-auth-plugin user.
func (d *DiscoveryAPI) HandleGKEImport(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	var body struct {
		Project  string `json:"project"`
		Location string `json:"location"`
		Name     string `json:"name"`
	}
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if !clouddiscovery.ValidGCPProject(body.Project) || !clouddiscovery.ValidGKELocation(body.Location) || !clouddiscovery.ValidGKEName(body.Name) {
		http.Error(w, "invalid project, location or cluster name", http.StatusBadRequest)
		return
	}
	if pinned := d.Clusters.ExplicitKubeconfig(); pinned != "" {
		http.Error(w, fmt.Sprintf("Kubebay was started with one dedicated kubeconfig (%s) and loads nothing else; add this cluster to that file instead: KUBECONFIG=%s gcloud container clusters get-credentials %s --location %s --project %s", pinned, pinned, body.Name, body.Location, body.Project), http.StatusConflict)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	c, err := clouddiscovery.DescribeGKE(ctx, d.run(), body.Project, body.Location, body.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if d.knownContexts()[c.Context] {
		http.Error(w, fmt.Sprintf("%s is already in a loaded kubeconfig", c.Context), http.StatusConflict)
		return
	}
	kc, err := clouddiscovery.GKEKubeconfig(c)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	path, err := d.writeDiscovered(clouddiscovery.GKEFileName(c), kc)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"path": path, "context": c.Context})
}

// serverKey is an API server URL reduced to host:port, so one written with
// or without :443 or a trailing slash still matches.
func serverKey(server string) string {
	u, err := url.Parse(strings.TrimSpace(server))
	if err != nil || u.Host == "" {
		return ""
	}
	host, port := u.Hostname(), u.Port()
	if port == "" {
		port = "443"
	}
	return strings.ToLower(net.JoinHostPort(host, port))
}

// knownServers are the API servers every loaded kubeconfig already reaches.
func (d *DiscoveryAPI) knownServers() map[string]bool {
	known := map[string]bool{}
	for _, c := range d.Clusters.List() {
		if k := serverKey(c.Server); k != "" {
			known[k] = true
		}
	}
	return known
}

// HandleAzureSubscriptions lists the subscriptions the signed-in az account can use.
func (d *DiscoveryAPI) HandleAzureSubscriptions(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	subs, err := clouddiscovery.AzureSubscriptions(ctx, d.run())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, subs)
}

type discoveredAKS struct {
	clouddiscovery.AKSCluster
	// Imported: a loaded kubeconfig already has this cluster, by Kubebay's
	// context name or by its API server (az names contexts after the cluster).
	Imported bool `json:"imported"`
}

// HandleAKSScan lists one subscription's AKS clusters in every resource group.
func (d *DiscoveryAPI) HandleAKSScan(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	var body struct {
		Subscription string `json:"subscription"`
	}
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	res := clouddiscovery.ScanAKS(ctx, d.run(), body.Subscription)
	contexts, servers := d.knownContexts(), d.knownServers()
	out := make([]discoveredAKS, 0, len(res.Clusters))
	for _, c := range res.Clusters {
		imported := contexts[c.Context] || (c.Endpoint != "" && servers[serverKey("https://"+c.Endpoint)])
		out = append(out, discoveredAKS{AKSCluster: c, Imported: imported})
	}
	writeJSON(w, map[string]any{"clusters": out, "errors": res.Errors})
}

// HandleAKSImport describes the cluster again (never trusting the browser
// about Entra ID), refuses clusters without it, reads the endpoint and CA
// from its user credential, and imports it with a kubelogin azurecli user.
func (d *DiscoveryAPI) HandleAKSImport(w http.ResponseWriter, r *http.Request) {
	if d.blocked(w) {
		return
	}
	var body struct {
		Subscription  string `json:"subscription"`
		ResourceGroup string `json:"resourceGroup"`
		Name          string `json:"name"`
	}
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if !clouddiscovery.ValidAzureSubscription(body.Subscription) || !clouddiscovery.ValidAzureResourceGroup(body.ResourceGroup) || !clouddiscovery.ValidAKSName(body.Name) {
		http.Error(w, "invalid subscription, resource group or cluster name", http.StatusBadRequest)
		return
	}
	if pinned := d.Clusters.ExplicitKubeconfig(); pinned != "" {
		http.Error(w, fmt.Sprintf("Kubebay was started with one dedicated kubeconfig (%s) and loads nothing else; add this cluster to that file instead: az aks get-credentials --subscription %s --resource-group %s --name %s --file %s, then kubelogin convert-kubeconfig -l azurecli --kubeconfig %s", pinned, body.Subscription, body.ResourceGroup, body.Name, pinned, pinned), http.StatusConflict)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	c, err := clouddiscovery.DescribeAKS(ctx, d.run(), body.Subscription, body.ResourceGroup, body.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if !c.Importable {
		http.Error(w, c.Name+" "+c.Reason, http.StatusUnprocessableEntity)
		return
	}
	if d.knownContexts()[c.Context] {
		http.Error(w, fmt.Sprintf("%s is already in a loaded kubeconfig", c.Context), http.StatusConflict)
		return
	}
	access, err := clouddiscovery.AKSAccess(ctx, d.run(), c)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if d.knownServers()[serverKey(access.Server)] {
		http.Error(w, fmt.Sprintf("%s is already in a loaded kubeconfig (same API server)", c.Name), http.StatusConflict)
		return
	}
	kc, err := clouddiscovery.AKSKubeconfig(c, access)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	path, err := d.writeDiscovered(clouddiscovery.AKSFileName(c), kc)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"path": path, "context": c.Context})
}
