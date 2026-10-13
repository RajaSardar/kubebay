package clouddiscovery

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

var (
	azureSubRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$`)
	// Resource groups: up to 90 letters, digits, _ . ( ) and -, not ending in
	// a period. Kubebay also refuses a leading - so none reads as a flag.
	azureRGRe = regexp.MustCompile(`^[A-Za-z0-9_.()][A-Za-z0-9_.()-]{0,88}[A-Za-z0-9_()-]$|^[A-Za-z0-9_()]$`)
	// AKS cluster names: up to 63 letters, digits, _ and -, starting and
	// ending with a letter or digit.
	aksNameRe = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9_-]{0,61}[A-Za-z0-9])?$`)
)

// aksServerApp is the Entra ID application every AKS API server accepts
// tokens for, used when the credential doesn't name one.
const aksServerApp = "6dae42f8-4368-4678-94ff-3960e28e3630"

// aksCredentialAPI is the ARM API version Kubebay reads user credentials
// with; it takes format=exec.
const aksCredentialAPI = "2024-09-01"

func ValidAzureSubscription(s string) bool  { return azureSubRe.MatchString(s) }
func ValidAzureResourceGroup(g string) bool { return azureRGRe.MatchString(g) }
func ValidAKSName(n string) bool            { return aksNameRe.MatchString(n) }

// AzureSubscription is one subscription the signed-in az account can use.
type AzureSubscription struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	Default bool   `json:"default,omitempty"`
}

// AzureSubscriptions lists the enabled subscriptions, az's default first.
func AzureSubscriptions(ctx context.Context, run Runner) ([]AzureSubscription, error) {
	out, err := run(ctx, "az", "account", "list", "--output", "json")
	if err != nil {
		return nil, fmt.Errorf("%s", explainAz(err))
	}
	var list []struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		IsDefault bool   `json:"isDefault"`
		State     string `json:"state"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return nil, fmt.Errorf("unexpected az output: %w", err)
	}
	subs := []AzureSubscription{}
	for _, s := range list {
		if ValidAzureSubscription(s.ID) && s.State != "Disabled" {
			subs = append(subs, AzureSubscription{ID: strings.ToLower(s.ID), Name: s.Name, Default: s.IsDefault})
		}
	}
	sort.SliceStable(subs, func(i, j int) bool {
		if subs[i].Default != subs[j].Default {
			return subs[i].Default
		}
		return subs[i].Name < subs[j].Name
	})
	return subs, nil
}

// AKSCluster is one cluster `az aks list` or `az aks show` returned.
type AKSCluster struct {
	Subscription  string `json:"subscription"`
	ResourceGroup string `json:"resourceGroup"`
	Name          string `json:"name"`
	Location      string `json:"location"`
	// Context is the kubeconfig context an import writes.
	Context  string `json:"context"`
	Endpoint string `json:"endpoint"`
	// Private: the API server is reachable only from its own network.
	Private bool   `json:"private,omitempty"`
	Status  string `json:"status,omitempty"`
	Version string `json:"version,omitempty"`
	// EntraID: the cluster signs users in with Microsoft Entra ID. Kubebay
	// imports only these, through kubelogin, so no client certificate or
	// static token ever lands on disk.
	EntraID    bool   `json:"entraID"`
	Importable bool   `json:"importable"`
	Reason     string `json:"reason,omitempty"`
}

type AKSScanResult struct {
	Clusters []AKSCluster  `json:"clusters"`
	Errors   []RegionError `json:"errors"`
}

type aksJSON struct {
	Name                     string  `json:"name"`
	ResourceGroup            string  `json:"resourceGroup"`
	Location                 string  `json:"location"`
	FQDN                     *string `json:"fqdn"`
	PrivateFQDN              *string `json:"privateFqdn"`
	KubernetesVersion        string  `json:"kubernetesVersion"`
	CurrentKubernetesVersion string  `json:"currentKubernetesVersion"`
	ProvisioningState        string  `json:"provisioningState"`
	PowerState               *struct {
		Code string `json:"code"`
	} `json:"powerState"`
	AADProfile             *json.RawMessage `json:"aadProfile"`
	APIServerAccessProfile *struct {
		EnablePrivateCluster bool `json:"enablePrivateCluster"`
	} `json:"apiServerAccessProfile"`
}

const noEntraID = "uses local Kubernetes accounts, not Microsoft Entra ID. Kubebay imports only Entra ID clusters, so no client certificate is written to disk; turn on Entra ID integration, or use az aks get-credentials yourself"

// aksContext names an imported cluster aks_<first 8 of subscription>_<group>/<name>.
// "/" is in neither a resource group nor a cluster name, so the shell can
// split the name back out (lib/clusterDistro.ts).
func aksContext(sub, rg, name string) string {
	return "aks_" + strings.ToLower(sub)[:8] + "_" + rg + "/" + name
}

func (a aksJSON) cluster(sub string) AKSCluster {
	c := AKSCluster{
		Subscription:  strings.ToLower(sub),
		ResourceGroup: a.ResourceGroup,
		Name:          a.Name,
		Location:      a.Location,
		Context:       aksContext(sub, a.ResourceGroup, a.Name),
		Version:       a.CurrentKubernetesVersion,
		Status:        a.ProvisioningState,
		EntraID:       a.AADProfile != nil && string(*a.AADProfile) != "null",
	}
	if c.Version == "" {
		c.Version = a.KubernetesVersion
	}
	if a.PowerState != nil && a.PowerState.Code != "" && (c.Status == "" || c.Status == "Succeeded") {
		c.Status = a.PowerState.Code
	}
	c.Private = a.APIServerAccessProfile != nil && a.APIServerAccessProfile.EnablePrivateCluster
	if a.FQDN != nil && *a.FQDN != "" && !c.Private {
		c.Endpoint = *a.FQDN
	} else if a.PrivateFQDN != nil {
		c.Endpoint = *a.PrivateFQDN
	}
	c.Importable = c.EntraID
	if !c.EntraID {
		c.Reason = noEntraID
	}
	return c
}

// ScanAKS lists a subscription's clusters in every resource group with one call.
func ScanAKS(ctx context.Context, run Runner, subscription string) AKSScanResult {
	res := AKSScanResult{Clusters: []AKSCluster{}, Errors: []RegionError{}}
	if !ValidAzureSubscription(subscription) {
		res.Errors = append(res.Errors, RegionError{Message: fmt.Sprintf("%q is not an Azure subscription ID", subscription)})
		return res
	}
	out, err := run(ctx, "az", "aks", "list", "--subscription", subscription, "--output", "json")
	if err != nil {
		res.Errors = append(res.Errors, RegionError{Message: explainAz(err)})
		return res
	}
	var list []aksJSON
	if err := json.Unmarshal(out, &list); err != nil {
		res.Errors = append(res.Errors, RegionError{Message: "unexpected az output: " + err.Error()})
		return res
	}
	for _, a := range list {
		if ValidAKSName(a.Name) && ValidAzureResourceGroup(a.ResourceGroup) {
			res.Clusters = append(res.Clusters, a.cluster(subscription))
		}
	}
	sort.Slice(res.Clusters, func(i, j int) bool {
		a, b := res.Clusters[i], res.Clusters[j]
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.ResourceGroup < b.ResourceGroup
	})
	return res
}

// DescribeAKS reads one cluster again, so an import never trusts the browser
// about whether it uses Entra ID.
func DescribeAKS(ctx context.Context, run Runner, subscription, group, name string) (AKSCluster, error) {
	if !ValidAzureSubscription(subscription) || !ValidAzureResourceGroup(group) || !ValidAKSName(name) {
		return AKSCluster{}, fmt.Errorf("invalid subscription, resource group or cluster name")
	}
	out, err := run(ctx, "az", "aks", "show", "--subscription", subscription, "--resource-group", group, "--name", name, "--output", "json")
	if err != nil {
		return AKSCluster{}, fmt.Errorf("%s", explainAz(err))
	}
	var a aksJSON
	if err := json.Unmarshal(out, &a); err != nil {
		return AKSCluster{}, fmt.Errorf("unexpected az output: %w", err)
	}
	if a.Name != name {
		return AKSCluster{}, fmt.Errorf("az described %q, not %q", a.Name, name)
	}
	a.ResourceGroup = group
	return a.cluster(subscription), nil
}

// AKSClusterAccess is what an import keeps from the cluster's user
// credential: where the API server is, its CA, and the Entra ID app its
// tokens are for. Anything else in the credential is dropped.
type AKSClusterAccess struct {
	Server   string
	CAData   []byte
	ServerID string
}

// AKSAccess reads the cluster's user credential (exec format) from the ARM
// action `az aks get-credentials` calls, through `az rest`, which writes no
// file. get-credentials itself may run `kubelogin convert-kubeconfig`
// against the user's own kubeconfig, which Kubebay never touches.
func AKSAccess(ctx context.Context, run Runner, c AKSCluster) (AKSClusterAccess, error) {
	if !c.EntraID {
		return AKSClusterAccess{}, fmt.Errorf("%s %s", c.Name, noEntraID)
	}
	if !ValidAzureSubscription(c.Subscription) || !ValidAzureResourceGroup(c.ResourceGroup) || !ValidAKSName(c.Name) {
		return AKSClusterAccess{}, fmt.Errorf("invalid subscription, resource group or cluster name")
	}
	// The query goes in --uri-parameters: on Windows az is az.cmd, and
	// cmd.exe would split a URL at its &.
	path := fmt.Sprintf("/subscriptions/%s/resourceGroups/%s/providers/Microsoft.ContainerService/managedClusters/%s/listClusterUserCredential",
		c.Subscription, url.PathEscape(c.ResourceGroup), c.Name)
	out, err := run(ctx, "az", "rest", "--method", "post", "--url", path,
		"--uri-parameters", "api-version="+aksCredentialAPI, "format=exec", "--output", "json")
	if err != nil {
		return AKSClusterAccess{}, fmt.Errorf("%s", explainAz(err))
	}
	var res struct {
		Kubeconfigs []struct {
			Value string `json:"value"`
		} `json:"kubeconfigs"`
	}
	if err := json.Unmarshal(out, &res); err != nil || len(res.Kubeconfigs) == 0 {
		return AKSClusterAccess{}, fmt.Errorf("az returned no credential for %s", c.Name)
	}
	raw, err := base64.StdEncoding.DecodeString(res.Kubeconfigs[0].Value)
	if err != nil {
		return AKSClusterAccess{}, fmt.Errorf("unreadable credential for %s: %w", c.Name, err)
	}
	cfg, err := clientcmd.Load(raw)
	if err != nil {
		return AKSClusterAccess{}, fmt.Errorf("unreadable credential for %s: %w", c.Name, err)
	}
	ctxName := cfg.CurrentContext
	kctx := cfg.Contexts[ctxName]
	if kctx == nil || cfg.Clusters[kctx.Cluster] == nil {
		return AKSClusterAccess{}, fmt.Errorf("the credential for %s names no cluster", c.Name)
	}
	cl := cfg.Clusters[kctx.Cluster]
	if u, err := url.Parse(cl.Server); err != nil || u.Scheme != "https" || u.Host == "" {
		return AKSClusterAccess{}, fmt.Errorf("the credential for %s has no https API server", c.Name)
	}
	if len(cl.CertificateAuthorityData) == 0 {
		return AKSClusterAccess{}, fmt.Errorf("cluster %s has no usable certificate authority", c.Name)
	}
	serverID := aksServerApp
	if u := cfg.AuthInfos[kctx.AuthInfo]; u != nil && u.Exec != nil {
		for i, a := range u.Exec.Args {
			if a == "--server-id" && i+1 < len(u.Exec.Args) {
				serverID = u.Exec.Args[i+1]
			}
		}
	}
	if !azureSubRe.MatchString(serverID) {
		return AKSClusterAccess{}, fmt.Errorf("the credential for %s names an unexpected server app", c.Name)
	}
	return AKSClusterAccess{Server: cl.Server, CAData: cl.CertificateAuthorityData, ServerID: strings.ToLower(serverID)}, nil
}

// AKSKubeconfig writes a one-cluster kubeconfig whose user is kubelogin in
// azurecli mode, as `kubelogin convert-kubeconfig -l azurecli` writes it:
// tokens come from the user's own az login, never from the file.
func AKSKubeconfig(c AKSCluster, a AKSClusterAccess) ([]byte, error) {
	if !c.EntraID {
		return nil, fmt.Errorf("%s %s", c.Name, noEntraID)
	}
	if a.Server == "" || len(a.CAData) == 0 || !azureSubRe.MatchString(a.ServerID) {
		return nil, fmt.Errorf("cluster %s has no usable endpoint or certificate authority", c.Name)
	}
	name := c.Context
	cfg := clientcmdapi.NewConfig()
	cfg.Clusters[name] = &clientcmdapi.Cluster{Server: a.Server, CertificateAuthorityData: a.CAData}
	cfg.AuthInfos[name] = &clientcmdapi.AuthInfo{Exec: &clientcmdapi.ExecConfig{
		APIVersion:      "client.authentication.k8s.io/v1beta1",
		Command:         "kubelogin",
		Args:            []string{"get-token", "--login", "azurecli", "--server-id", a.ServerID},
		InstallHint:     "kubelogin is not installed. Install it with `az aks install-cli` or from https://azure.github.io/kubelogin/install.html, and sign in with `az login`.",
		InteractiveMode: clientcmdapi.NeverExecInteractiveMode,
	}}
	cfg.Contexts[name] = &clientcmdapi.Context{Cluster: name, AuthInfo: name}
	cfg.CurrentContext = name
	return clientcmd.Write(*cfg)
}

// AKSFileName is the Kubebay-owned file one imported cluster lives in.
func AKSFileName(c AKSCluster) string {
	return fmt.Sprintf("aks-%s-%s-%s.yaml", c.Subscription, c.ResourceGroup, c.Name)
}

// explainAz turns the CLI's error into what to do about it.
func explainAz(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "not found on PATH"):
		return "az CLI not found on PATH: install the Azure CLI to discover AKS clusters"
	case strings.Contains(msg, "AADSTS") || strings.Contains(msg, "refresh token") || strings.Contains(msg, "Interactive authentication is needed"):
		return "the az login has expired: run `az login`, then scan again"
	case strings.Contains(msg, "az login"):
		return "the Azure CLI isn't signed in: run `az login`, then scan again"
	case strings.Contains(msg, "MissingSubscriptionRegistration"):
		return "this subscription isn't registered for Microsoft.ContainerService, so it has no AKS clusters"
	case strings.Contains(msg, "SubscriptionNotFound") || strings.Contains(msg, "InvalidSubscriptionId"):
		return "that subscription wasn't found, or this account can't use it: pick another, or run `az account list`"
	case strings.Contains(msg, "AuthorizationFailed") || strings.Contains(msg, "does not have authorization"):
		return "this account isn't allowed to read AKS clusters here: it needs Microsoft.ContainerService/managedClusters/read, and listClusterUserCredential/action to import (the Azure Kubernetes Service Cluster User role)"
	}
	if len(msg) > 300 {
		msg = msg[:300]
	}
	return msg
}
