package clouddiscovery

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

var (
	// Project IDs: 6–30 lowercase letters, digits and hyphens, starting with
	// a letter; legacy ones carry a "domain:" prefix.
	gcpProjectRe = regexp.MustCompile(`^([a-z][a-z0-9.-]*[a-z0-9]:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$`)
	// A region (europe-west1) or a zone (europe-west1-b).
	gkeLocationRe = regexp.MustCompile(`^[a-z]+-[a-z]+[0-9]+(-[a-z])?$`)
	// Cluster names: up to 40 lowercase letters, digits and hyphens.
	gkeNameRe = regexp.MustCompile(`^[a-z]([-a-z0-9]{0,38}[a-z0-9])?$`)
)

func ValidGCPProject(p string) bool    { return gcpProjectRe.MatchString(p) }
func ValidGKELocation(l string) bool   { return gkeLocationRe.MatchString(l) }
func ValidGKEName(n string) bool       { return gkeNameRe.MatchString(n) }
func gkeContext(p, l, n string) string { return "gke_" + p + "_" + l + "_" + n }

// GKECluster is one cluster `gcloud container clusters list` returned.
type GKECluster struct {
	Project  string `json:"project"`
	Location string `json:"location"`
	Name     string `json:"name"`
	// Context is the name `gcloud container clusters get-credentials` gives
	// it, so a cluster already imported that way is recognised.
	Context  string `json:"context"`
	Endpoint string `json:"endpoint"`
	Status   string `json:"status,omitempty"`
	Version  string `json:"version,omitempty"`
	// CAData is the base64 cluster CA. Not sent to the browser; import
	// describes the cluster again itself.
	CAData string `json:"-"`
}

type GKEScanResult struct {
	Clusters []GKECluster  `json:"clusters"`
	Errors   []RegionError `json:"errors"`
}

type gkeJSON struct {
	Name                 string `json:"name"`
	Location             string `json:"location"`
	Endpoint             string `json:"endpoint"`
	Status               string `json:"status"`
	CurrentMasterVersion string `json:"currentMasterVersion"`
	MasterAuth           struct {
		ClusterCaCertificate string `json:"clusterCaCertificate"`
	} `json:"masterAuth"`
}

func (g gkeJSON) cluster(project string) GKECluster {
	return GKECluster{
		Project:  project,
		Location: g.Location,
		Name:     g.Name,
		Context:  gkeContext(project, g.Location, g.Name),
		Endpoint: g.Endpoint,
		Status:   g.Status,
		Version:  g.CurrentMasterVersion,
		CAData:   g.MasterAuth.ClusterCaCertificate,
	}
}

// ScanGKE lists a project's clusters in every location with one call.
func ScanGKE(ctx context.Context, run Runner, project string) GKEScanResult {
	res := GKEScanResult{Clusters: []GKECluster{}, Errors: []RegionError{}}
	if !ValidGCPProject(project) {
		res.Errors = append(res.Errors, RegionError{Message: fmt.Sprintf("%q is not a Google Cloud project ID", project)})
		return res
	}
	out, err := run(ctx, "gcloud", "container", "clusters", "list", "--project", project, "--format=json")
	if err != nil {
		res.Errors = append(res.Errors, RegionError{Message: explainGcloud(err)})
		return res
	}
	var list []gkeJSON
	if err := json.Unmarshal(out, &list); err != nil {
		res.Errors = append(res.Errors, RegionError{Message: "unexpected gcloud output: " + err.Error()})
		return res
	}
	for _, g := range list {
		if ValidGKEName(g.Name) && ValidGKELocation(g.Location) {
			res.Clusters = append(res.Clusters, g.cluster(project))
		}
	}
	sort.Slice(res.Clusters, func(i, j int) bool {
		a, b := res.Clusters[i], res.Clusters[j]
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.Location < b.Location
	})
	return res
}

// DescribeGKE reads one cluster's endpoint and CA.
func DescribeGKE(ctx context.Context, run Runner, project, location, name string) (GKECluster, error) {
	if !ValidGCPProject(project) || !ValidGKELocation(location) || !ValidGKEName(name) {
		return GKECluster{}, fmt.Errorf("invalid project, location or cluster name")
	}
	out, err := run(ctx, "gcloud", "container", "clusters", "describe", name, "--location", location, "--project", project, "--format=json")
	if err != nil {
		return GKECluster{}, fmt.Errorf("%s", explainGcloud(err))
	}
	var g gkeJSON
	if err := json.Unmarshal(out, &g); err != nil {
		return GKECluster{}, fmt.Errorf("unexpected gcloud output: %w", err)
	}
	return g.cluster(project), nil
}

// explainGcloud turns the CLI's error into what to do about it.
func explainGcloud(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "not found on PATH"):
		return "gcloud CLI not found on PATH: install the Google Cloud CLI to discover GKE clusters"
	case strings.Contains(msg, "Reauthentication") || strings.Contains(msg, "refreshing your current auth tokens") || strings.Contains(msg, "invalid_grant"):
		return "the gcloud login has expired: run `gcloud auth login`, then scan again"
	case strings.Contains(msg, "active account selected") || strings.Contains(msg, "credentialed accounts"):
		return "gcloud has no account signed in: run `gcloud auth login`"
	case strings.Contains(msg, "Kubernetes Engine API has not been used") || strings.Contains(msg, "SERVICE_DISABLED"):
		return "the Kubernetes Engine API isn't enabled in this project: enable container.googleapis.com, or pick another project"
	case strings.Contains(msg, "container.clusters.list") || strings.Contains(msg, "container.clusters.get") || strings.Contains(msg, "PERMISSION_DENIED") || strings.Contains(msg, "code=403"):
		return "this account isn't allowed to list clusters here: it needs container.clusters.list and container.clusters.get"
	}
	if len(msg) > 300 {
		msg = msg[:300]
	}
	return msg
}

// GKEKubeconfig writes a one-cluster kubeconfig the way `gcloud container
// clusters get-credentials` does: named gke_PROJECT_LOCATION_NAME, with an
// exec stanza for gke-gcloud-auth-plugin, never a static token.
func GKEKubeconfig(c GKECluster) ([]byte, error) {
	ca, err := base64.StdEncoding.DecodeString(c.CAData)
	if err != nil || len(ca) == 0 {
		return nil, fmt.Errorf("cluster %s has no usable certificate authority", c.Name)
	}
	if c.Endpoint == "" {
		return nil, fmt.Errorf("cluster %s has no endpoint yet", c.Name)
	}
	name := gkeContext(c.Project, c.Location, c.Name)
	cfg := clientcmdapi.NewConfig()
	cfg.Clusters[name] = &clientcmdapi.Cluster{Server: "https://" + c.Endpoint, CertificateAuthorityData: ca}
	cfg.AuthInfos[name] = &clientcmdapi.AuthInfo{Exec: &clientcmdapi.ExecConfig{
		APIVersion:         "client.authentication.k8s.io/v1beta1",
		Command:            "gke-gcloud-auth-plugin",
		InstallHint:        "Install gke-gcloud-auth-plugin for use with kubectl by following https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl#install_plugin (gcloud components install gke-gcloud-auth-plugin)",
		ProvideClusterInfo: true,
		InteractiveMode:    clientcmdapi.NeverExecInteractiveMode,
	}}
	cfg.Contexts[name] = &clientcmdapi.Context{Cluster: name, AuthInfo: name}
	cfg.CurrentContext = name
	return clientcmd.Write(*cfg)
}

// GKEFileName is the Kubebay-owned file one imported cluster lives in.
func GKEFileName(c GKECluster) string {
	return fmt.Sprintf("gke-%s-%s-%s.yaml", strings.ReplaceAll(c.Project, ":", "_"), c.Location, c.Name)
}

// GCPProject is one project the signed-in gcloud account can see.
type GCPProject struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	Default bool   `json:"default,omitempty"`
}

// GCPProjects lists up to 200 projects, marking gcloud's default one.
func GCPProjects(ctx context.Context, run Runner) ([]GCPProject, error) {
	out, err := run(ctx, "gcloud", "projects", "list", "--format=json", "--limit=200")
	if err != nil {
		return nil, fmt.Errorf("%s", explainGcloud(err))
	}
	var list []struct {
		ProjectID string `json:"projectId"`
		Name      string `json:"name"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return nil, fmt.Errorf("unexpected gcloud output: %w", err)
	}
	def := ""
	if b, err := run(ctx, "gcloud", "config", "get-value", "project"); err == nil {
		def = strings.TrimSpace(string(b))
	}
	projects := []GCPProject{}
	for _, p := range list {
		if ValidGCPProject(p.ProjectID) {
			projects = append(projects, GCPProject{ID: p.ProjectID, Name: p.Name, Default: p.ProjectID == def})
		}
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].ID < projects[j].ID })
	return projects, nil
}
