package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const azSub = "1a2b3c4d-1111-2222-3333-444455556666"

// fakeAzure is the user's az on top of fakeClouds: subscription azSub has
// web (Entra ID) in shop-rg and legacy (local accounts) in old-rg.
func fakeAzure(ctx context.Context, name string, args ...string) ([]byte, error) {
	if name != "az" {
		return fakeClouds(ctx, name, args...)
	}
	const web = `{"name":"web","resourceGroup":"shop-rg","location":"westeurope","fqdn":"web-dns-abc.hcp.westeurope.azmk8s.io","currentKubernetesVersion":"1.31.2","provisioningState":"Succeeded","powerState":{"code":"Running"},"aadProfile":{"managed":true}}`
	const legacy = `{"name":"legacy","resourceGroup":"old-rg","location":"eastus","fqdn":"legacy-dns.hcp.eastus.azmk8s.io","provisioningState":"Succeeded","aadProfile":null}`
	kc := "apiVersion: v1\nkind: Config\nclusters:\n- name: web\n  cluster:\n    certificate-authority-data: Q0EtREFUQQ==\n    server: https://web-dns-abc.hcp.westeurope.azmk8s.io:443\ncontexts:\n- name: web\n  context:\n    cluster: web\n    user: clusterUser_shop-rg_web\ncurrent-context: web\nusers:\n- name: clusterUser_shop-rg_web\n  user:\n    exec:\n      apiVersion: client.authentication.k8s.io/v1beta1\n      command: kubelogin\n      args: [get-token, --server-id, 6dae42f8-4368-4678-94ff-3960e28e3630, --login, devicecode]\n"
	switch joined := strings.Join(args, " "); joined {
	case "account list --output json":
		return []byte(`[{"id":"` + azSub + `","name":"Prod","isDefault":true,"state":"Enabled"}]`), nil
	case "aks list --subscription " + azSub + " --output json":
		return []byte("[" + web + "," + legacy + "]"), nil
	case "aks show --subscription " + azSub + " --resource-group shop-rg --name web --output json":
		return []byte(web), nil
	case "aks show --subscription " + azSub + " --resource-group old-rg --name legacy --output json":
		return []byte(legacy), nil
	case "rest --method post --url /subscriptions/" + azSub + "/resourceGroups/shop-rg/providers/Microsoft.ContainerService/managedClusters/web/listClusterUserCredential --uri-parameters api-version=2024-09-01 format=exec --output json":
		return []byte(`{"kubeconfigs":[{"name":"clusterUser","value":"` + base64.StdEncoding.EncodeToString([]byte(kc)) + `"}]}`), nil
	default:
		return nil, fmt.Errorf("unexpected az %s", joined)
	}
}

func TestAKSDiscoveryListsSubscriptions(t *testing.T) {
	d, _ := discoveryAPI(t)
	d.Run = fakeAzure
	rec := call(t, d.HandleAzureSubscriptions, http.MethodGet, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `{"id":"`+azSub+`","name":"Prod","default":true}`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

// A cluster already fetched with `az aks get-credentials` is named after
// the cluster, so it's recognised by its API server.
func TestAKSScanMarksClustersAlreadyInAKubeconfigByServer(t *testing.T) {
	d, sm := discoveryAPI(t)
	d.Run = fakeAzure
	kc := os.Getenv("KUBEBAY_KUBECONFIG")
	b, _ := os.ReadFile(kc)
	with := strings.Replace(string(b), "clusters:\n", "clusters:\n- name: web\n  cluster:\n    server: https://web-dns-abc.hcp.westeurope.azmk8s.io:443\n", 1)
	with = strings.Replace(with, "contexts:\n", "contexts:\n- name: web\n  context:\n    cluster: web\n    user: u\n", 1)
	if err := os.WriteFile(kc, []byte(with), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := sm.mgr.Load(); err != nil {
		t.Fatal(err)
	}
	rec := call(t, d.HandleAKSScan, http.MethodPost, `{"subscription":"`+azSub+`"}`)
	var got struct {
		Clusters []struct {
			Name       string `json:"name"`
			Imported   bool   `json:"imported"`
			Importable bool   `json:"importable"`
			Reason     string `json:"reason"`
		} `json:"clusters"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || len(got.Clusters) != 2 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if got.Clusters[1].Name != "web" || !got.Clusters[1].Imported || !got.Clusters[1].Importable {
		t.Errorf("web: %s", rec.Body)
	}
	if got.Clusters[0].Name != "legacy" || got.Clusters[0].Imported || got.Clusters[0].Importable || !strings.Contains(got.Clusters[0].Reason, "Entra ID") {
		t.Errorf("legacy: %s", rec.Body)
	}
	if rec := call(t, d.HandleAKSScan, http.MethodPost, `{"subscription":"--query=x"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "not an Azure subscription ID") {
		t.Errorf("bad subscription: %d %s", rec.Code, rec.Body)
	}
}

func TestAKSImportWritesAKubeloginKubeconfigAndLoadsIt(t *testing.T) {
	d, sm, kc := unpinnedDiscoveryAPI(t)
	d.Run = fakeAzure
	before, _ := os.ReadFile(kc)
	body := `{"subscription":"` + azSub + `","resourceGroup":"shop-rg","name":"web"}`
	rec := call(t, d.HandleAKSImport, http.MethodPost, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, ".kubebay", "discovered", "aks-"+azSub+"-shop-rg-web.yaml")
	st, err := os.Stat(path)
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("file: %v %v", err, st)
	}
	written, _ := os.ReadFile(path)
	if !strings.Contains(string(written), "azurecli") || strings.Contains(string(written), "devicecode") || strings.Contains(string(written), "token:") {
		t.Errorf("kubeconfig:\n%s", written)
	}
	loaded := false
	for _, c := range sm.mgr.List() {
		loaded = loaded || c.Context == "aks_1a2b3c4d_shop-rg_web"
	}
	if !loaded {
		t.Error("the imported context isn't loaded")
	}
	if after, _ := os.ReadFile(kc); string(after) != string(before) {
		t.Error("the user's own kubeconfig must never be written")
	}
	if rec := call(t, d.HandleAKSImport, http.MethodPost, body); rec.Code != http.StatusConflict {
		t.Errorf("re-import: %d %s", rec.Code, rec.Body)
	}
}

func TestAKSImportRefusesLocalAccountClusters(t *testing.T) {
	d, sm, _ := unpinnedDiscoveryAPI(t)
	d.Run = fakeAzure
	rec := call(t, d.HandleAKSImport, http.MethodPost, `{"subscription":"`+azSub+`","resourceGroup":"old-rg","name":"legacy"}`)
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "Entra ID") {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
	if set, _ := sm.Load(); len(set.ExtraKubeconfigs) != 0 {
		t.Errorf("nothing is written: %v", set.ExtraKubeconfigs)
	}
}

func TestAKSImportExplainsAPinnedKubeconfigAndRejectsBadInput(t *testing.T) {
	d, _ := discoveryAPI(t)
	d.Run = fakeAzure
	rec := call(t, d.HandleAKSImport, http.MethodPost, `{"subscription":"`+azSub+`","resourceGroup":"shop-rg","name":"web"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "az aks get-credentials --subscription "+azSub+" --resource-group shop-rg --name web --file") || !strings.Contains(rec.Body.String(), "kubelogin convert-kubeconfig -l azurecli") {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
	for _, body := range []string{
		`{"subscription":"--x","resourceGroup":"shop-rg","name":"web"}`,
		`{"subscription":"` + azSub + `","resourceGroup":"-x","name":"web"}`,
		`{"subscription":"` + azSub + `","resourceGroup":"shop-rg","name":"--x"}`,
	} {
		if rec := call(t, d.HandleAKSImport, http.MethodPost, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
}

func TestAKSDiscoveryIsDesktopOnlyAndBehindTheToken(t *testing.T) {
	d, _ := discoveryAPI(t)
	d.Run = fakeAzure
	d.Disabled = "off"
	for name, h := range map[string]http.HandlerFunc{"subscriptions": d.HandleAzureSubscriptions, "scan": d.HandleAKSScan, "import": d.HandleAKSImport} {
		if rec := call(t, h, http.MethodPost, `{"subscription":"`+azSub+`","resourceGroup":"shop-rg","name":"web"}`); rec.Code != http.StatusForbidden {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	h := Router(Deps{Discovery: d}, "secret")
	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, "/api/discover/azure/subscriptions"},
		{http.MethodPost, "/api/discover/aks/scan"},
		{http.MethodPost, "/api/discover/aks/import"},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(rt.method, rt.path, strings.NewReader("{}")))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without the token: %d", rt.method, rt.path, rec.Code)
		}
		req := httptest.NewRequest(rt.method, rt.path, strings.NewReader("{}"))
		req.Header.Set("X-Kubebay-Token", "secret")
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s with the token: %d", rt.method, rt.path, rec.Code)
		}
	}
}
