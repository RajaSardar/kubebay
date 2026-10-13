package clouddiscovery

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const (
	subProd   = "1a2b3c4d-1111-2222-3333-444455556666"
	subLocked = "9f9f9f9f-0000-0000-0000-000000000000"
	aksServer = "6dae42f8-4368-4678-94ff-3960e28e3630"
)

const webJSON = `{"name":"web","resourceGroup":"shop-rg","location":"westeurope","fqdn":"web-dns-abc.hcp.westeurope.azmk8s.io","privateFqdn":null,
	"currentKubernetesVersion":"1.31.2","kubernetesVersion":"1.31","provisioningState":"Succeeded","powerState":{"code":"Running"},
	"aadProfile":{"managed":true,"enableAzureRbac":true,"tenantId":"t-1"},"disableLocalAccounts":true,"apiServerAccessProfile":null}`

const legacyJSON = `{"name":"legacy","resourceGroup":"old-rg","location":"eastus","fqdn":"legacy-dns.hcp.eastus.azmk8s.io",
	"currentKubernetesVersion":"1.29.4","provisioningState":"Succeeded","powerState":{"code":"Running"},"aadProfile":null,"disableLocalAccounts":false}`

// userKubeconfig is what listClusterUserCredential?format=exec returns for
// an Entra ID cluster: no secret, a devicecode kubelogin user.
const userKubeconfig = `apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: Q0EtREFUQQ==
    server: https://web-dns-abc.hcp.westeurope.azmk8s.io:443
  name: web
contexts:
- context:
    cluster: web
    user: clusterUser_shop-rg_web
  name: web
current-context: web
users:
- name: clusterUser_shop-rg_web
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: kubelogin
      args:
      - get-token
      - --environment
      - AzurePublicCloud
      - --server-id
      - ` + aksServer + `
      - --client-id
      - 80faf920-1908-4b52-b5ef-a8e7bedfc67a
      - --tenant-id
      - t-1
      - --login
      - devicecode
`

// fakeAz stands in for the user's az: subscription subProd has an Entra ID
// cluster, a local-accounts one, a private stopped one and a bad name;
// subLocked denies reads.
type fakeAz struct {
	calls [][]string
	creds string
}

func (f *fakeAz) run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string{name}, args...))
	joined := strings.Join(args, " ")
	credURL := "/subscriptions/" + subProd + "/resourceGroups/shop-rg/providers/Microsoft.ContainerService/managedClusters/web/listClusterUserCredential --uri-parameters api-version=2024-09-01 format=exec"
	switch joined {
	case "account list --output json":
		return []byte(`[{"id":"` + subProd + `","name":"Prod","isDefault":true,"state":"Enabled","tenantId":"t-1"},
			{"id":"--evil","name":"x","state":"Enabled"},
			{"id":"2b2b2b2b-0000-0000-0000-000000000000","name":"Closed","isDefault":false,"state":"Disabled"},
			{"id":"` + subLocked + `","name":"Locked","isDefault":false,"state":"Enabled"}]`), nil
	case "aks list --subscription " + subProd + " --output json":
		return []byte(`[` + webJSON + `,` + legacyJSON + `,
			{"name":"core","resourceGroup":"net-rg","location":"northeurope","fqdn":null,"privateFqdn":"core-xyz.privatelink.northeurope.azmk8s.io",
			 "apiServerAccessProfile":{"enablePrivateCluster":true},"aadProfile":{"managed":true},"powerState":{"code":"Stopped"},"currentKubernetesVersion":"1.30.1"},
			{"name":"--evil","resourceGroup":"rg"}]`), nil
	case "aks list --subscription " + subLocked + " --output json":
		return nil, errors.New("exit status 1: ERROR: (AuthorizationFailed) The client 'me@example.com' with object id 'x' does not have authorization to perform action 'Microsoft.ContainerService/managedClusters/read' over scope '/subscriptions/" + subLocked + "'")
	case "aks show --subscription " + subProd + " --resource-group shop-rg --name web --output json":
		return []byte(webJSON), nil
	case "aks show --subscription " + subProd + " --resource-group old-rg --name legacy --output json":
		return []byte(legacyJSON), nil
	case "rest --method post --url " + credURL + " --output json":
		kc := f.creds
		if kc == "" {
			kc = userKubeconfig
		}
		return []byte(`{"kubeconfigs":[{"name":"clusterUser","value":"` + base64.StdEncoding.EncodeToString([]byte(kc)) + `"}]}`), nil
	}
	return nil, fmt.Errorf("unexpected az %s", joined)
}

func TestAzureSubscriptionsListsTheEnabledOnes(t *testing.T) {
	subs, err := AzureSubscriptions(context.Background(), (&fakeAz{}).run)
	if err != nil {
		t.Fatal(err)
	}
	if len(subs) != 2 || subs[0].ID != subProd || subs[0].Name != "Prod" || !subs[0].Default || subs[1].ID != subLocked || subs[1].Default {
		t.Errorf("subscriptions = %+v (default first, no disabled or malformed ones)", subs)
	}
}

func TestScanAKSMarksOnlyEntraIDClustersImportable(t *testing.T) {
	f := &fakeAz{}
	res := ScanAKS(context.Background(), f.run, subProd)
	if len(res.Errors) != 0 || len(res.Clusters) != 3 {
		t.Fatalf("scan = %+v", res)
	}
	core, legacy, web := res.Clusters[0], res.Clusters[1], res.Clusters[2]
	if web.Name != "web" || web.ResourceGroup != "shop-rg" || web.Subscription != subProd || web.Location != "westeurope" ||
		web.Endpoint != "web-dns-abc.hcp.westeurope.azmk8s.io" || web.Version != "1.31.2" || web.Status != "Running" ||
		!web.EntraID || !web.Importable || web.Reason != "" || web.Context != "aks_1a2b3c4d_shop-rg_web" {
		t.Errorf("web = %+v", web)
	}
	if legacy.Importable || legacy.EntraID || !strings.Contains(legacy.Reason, "Entra ID") || !strings.Contains(legacy.Reason, "local") {
		t.Errorf("legacy = %+v", legacy)
	}
	if !core.Private || core.Endpoint != "core-xyz.privatelink.northeurope.azmk8s.io" || core.Status != "Stopped" || !core.Importable {
		t.Errorf("core = %+v", core)
	}
	if len(f.calls) != 1 {
		t.Errorf("one list call covers every resource group: %v", f.calls)
	}
}

func TestScanAKSExplainsWhatToDo(t *testing.T) {
	res := ScanAKS(context.Background(), (&fakeAz{}).run, subLocked)
	if len(res.Errors) != 1 || !strings.Contains(res.Errors[0].Message, "Microsoft.ContainerService/managedClusters/read") {
		t.Errorf("errors = %+v", res.Errors)
	}
	for in, want := range map[string]string{
		"az CLI not found on PATH: install it":                                                                                      "Azure CLI",
		"ERROR: Please run 'az login' to setup account.":                                                                            "az login",
		"ERROR: AADSTS700082: The refresh token has expired due to inactivity.":                                                     "az login",
		"ERROR: (SubscriptionNotFound) The subscription '1' could not be found.":                                                    "subscription",
		"ERROR: (MissingSubscriptionRegistration) The subscription is not registered to use namespace 'Microsoft.ContainerService'": "Microsoft.ContainerService",
	} {
		if got := explainAz(errors.New(in)); !strings.Contains(got, want) {
			t.Errorf("%q → %q, want it to mention %q", in, got, want)
		}
	}
}

func TestAKSNamesAreValidatedBeforeTheyReachArgv(t *testing.T) {
	f := &fakeAz{}
	for _, s := range []string{"--output=yaml", "Prod", "", "1a2b3c4d-1111-2222-3333-44445555666"} {
		if res := ScanAKS(context.Background(), f.run, s); len(res.Errors) != 1 {
			t.Errorf("subscription %q accepted", s)
		}
	}
	for _, tc := range [][2]string{{"-rg", "web"}, {"rg.", "web"}, {"rg/x", "web"}, {"shop-rg", "-web"}, {"shop-rg", "web_"}, {"shop-rg", strings.Repeat("a", 64)}} {
		if _, err := DescribeAKS(context.Background(), f.run, subProd, tc[0], tc[1]); err == nil {
			t.Errorf("resource group %q, name %q accepted", tc[0], tc[1])
		}
	}
	if len(f.calls) != 0 {
		t.Errorf("nothing invalid reaches az: %v", f.calls)
	}
	for _, ok := range [][2]string{{"shop-rg", "web"}, {"My_RG.(prod)", "a"}, {"rg", "web_1-x"}} {
		if !ValidAzureResourceGroup(ok[0]) || !ValidAKSName(ok[1]) {
			t.Errorf("%q / %q rejected", ok[0], ok[1])
		}
	}
}

// The credential comes from the same ARM action get-credentials calls, but
// through `az rest`, which writes no file and runs no kubelogin convert
// against the user's own kubeconfig.
func TestAKSAccessComesFromAzRestNotGetCredentials(t *testing.T) {
	f := &fakeAz{}
	c, err := DescribeAKS(context.Background(), f.run, subProd, "shop-rg", "web")
	if err != nil {
		t.Fatal(err)
	}
	a, err := AKSAccess(context.Background(), f.run, c)
	if err != nil {
		t.Fatal(err)
	}
	if a.Server != "https://web-dns-abc.hcp.westeurope.azmk8s.io:443" || string(a.CAData) != "CA-DATA" || a.ServerID != aksServer {
		t.Errorf("access = %+v", a)
	}
	for _, call := range f.calls {
		if strings.Contains(strings.Join(call, " "), "get-credentials") {
			t.Errorf("get-credentials can rewrite ~/.kube/config: %v", call)
		}
		// On Windows az is az.cmd, and cmd.exe splits a command at & or ?.
		for _, arg := range call {
			if strings.ContainsAny(arg, "&?|<>^") {
				t.Errorf("argument %q breaks under cmd.exe", arg)
			}
		}
	}
}

func TestAKSKubeconfigSignsInWithKubeloginAndTheAzureCLI(t *testing.T) {
	f := &fakeAz{}
	c, _ := DescribeAKS(context.Background(), f.run, subProd, "shop-rg", "web")
	a, _ := AKSAccess(context.Background(), f.run, c)
	b, err := AKSKubeconfig(c, a)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := clientcmd.Load(b)
	if err != nil {
		t.Fatal(err)
	}
	name := "aks_1a2b3c4d_shop-rg_web"
	if cfg.CurrentContext != name || cfg.Contexts[name] == nil || cfg.Clusters[name] == nil || cfg.AuthInfos[name] == nil {
		t.Fatalf("names: %+v", cfg)
	}
	cl := cfg.Clusters[name]
	if cl.Server != a.Server || string(cl.CertificateAuthorityData) != "CA-DATA" {
		t.Errorf("cluster = %+v", cl)
	}
	u := cfg.AuthInfos[name]
	if u.Token != "" || len(u.ClientCertificateData) != 0 || len(u.ClientKeyData) != 0 || u.AuthProvider != nil || u.Exec == nil {
		t.Fatalf("user carries a secret or no exec: %+v", u)
	}
	want := []string{"get-token", "--login", "azurecli", "--server-id", aksServer}
	if u.Exec.Command != "kubelogin" || !reflect.DeepEqual(u.Exec.Args, want) || u.Exec.APIVersion != "client.authentication.k8s.io/v1beta1" || u.Exec.InteractiveMode != clientcmdapi.NeverExecInteractiveMode || u.Exec.InstallHint == "" {
		t.Errorf("exec = %+v", u.Exec)
	}
	if got := AKSFileName(c); got != "aks-"+subProd+"-shop-rg-web.yaml" {
		t.Errorf("file = %q", got)
	}
}

func TestAKSRefusesClustersWithoutEntraID(t *testing.T) {
	f := &fakeAz{}
	c, err := DescribeAKS(context.Background(), f.run, subProd, "old-rg", "legacy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AKSAccess(context.Background(), f.run, c); err == nil || !strings.Contains(err.Error(), "Entra ID") {
		t.Errorf("err = %v", err)
	}
	if _, err := AKSKubeconfig(c, AKSClusterAccess{Server: "https://x:443", CAData: []byte("CA"), ServerID: aksServer}); err == nil {
		t.Error("a local-accounts cluster must not be written")
	}
	for _, call := range f.calls {
		if call[1] == "rest" {
			t.Errorf("credentials of a local-accounts cluster are never fetched: %v", call)
		}
	}
}

func TestAKSAccessFallsBackToTheAKSServerAppAndRejectsJunk(t *testing.T) {
	f := &fakeAz{creds: strings.Replace(userKubeconfig, "      - --server-id\n      - "+aksServer+"\n", "", 1)}
	c, _ := DescribeAKS(context.Background(), f.run, subProd, "shop-rg", "web")
	a, err := AKSAccess(context.Background(), f.run, c)
	if err != nil || a.ServerID != aksServer {
		t.Errorf("no --server-id: %+v %v", a, err)
	}
	f.creds = strings.Replace(userKubeconfig, aksServer, "not-a-guid; rm -rf", 1)
	if _, err := AKSAccess(context.Background(), f.run, c); err == nil {
		t.Error("a malformed server ID must not reach the kubeconfig")
	}
	f.creds = strings.Replace(userKubeconfig, "server: https://web-dns-abc.hcp.westeurope.azmk8s.io:443", "server: http://web:80", 1)
	if _, err := AKSAccess(context.Background(), f.run, c); err == nil {
		t.Error("only an https server is accepted")
	}
}
