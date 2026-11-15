package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeClouds is the user's aws (fakeEKS) and gcloud: project shop-prod has
// one regional cluster, web.
func fakeClouds(ctx context.Context, name string, args ...string) ([]byte, error) {
	if name != "gcloud" {
		return fakeEKS(ctx, name, args...)
	}
	const web = `{"name":"web","location":"europe-west1","endpoint":"34.1.2.3","status":"RUNNING","currentMasterVersion":"1.31.1-gke.100","masterAuth":{"clusterCaCertificate":"Q0EtREFUQQ=="}}`
	switch joined := strings.Join(args, " "); joined {
	case "projects list --format=json --limit=200":
		return []byte(`[{"projectId":"shop-prod","name":"Shop prod"}]`), nil
	case "config get-value project":
		return []byte("shop-prod\n"), nil
	case "container clusters list --project shop-prod --format=json":
		return []byte("[" + web + "]"), nil
	case "container clusters describe web --location europe-west1 --project shop-prod --format=json":
		return []byte(web), nil
	default:
		return nil, fmt.Errorf("unexpected gcloud %s", joined)
	}
}

func TestGKEDiscoveryListsProjects(t *testing.T) {
	d, _ := discoveryAPI(t)
	d.Run = fakeClouds
	rec := call(t, d.HandleGCPProjects, http.MethodGet, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `{"id":"shop-prod","name":"Shop prod","default":true}`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestGKEScanMarksImportedClustersAndKeepsTheCA(t *testing.T) {
	d, sm := discoveryAPI(t)
	d.Run = fakeClouds
	kc := os.Getenv("KUBEBAY_KUBECONFIG")
	b, _ := os.ReadFile(kc)
	with := strings.Replace(string(b), "contexts:\n", "contexts:\n- name: gke_shop-prod_europe-west1_web\n  context:\n    cluster: c\n    user: u\n", 1)
	if err := os.WriteFile(kc, []byte(with), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := sm.mgr.Load(); err != nil {
		t.Fatal(err)
	}
	rec := call(t, d.HandleGKEScan, http.MethodPost, `{"project":"shop-prod"}`)
	var got struct {
		Clusters []struct {
			Name     string `json:"name"`
			Location string `json:"location"`
			Imported bool   `json:"imported"`
		} `json:"clusters"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || len(got.Clusters) != 1 || got.Clusters[0].Name != "web" || !got.Clusters[0].Imported {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "Q0EtREFUQQ") {
		t.Error("the CA isn't sent to the browser")
	}
	if rec := call(t, d.HandleGKEScan, http.MethodPost, `{"project":"--impersonate-service-account=x"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "not a Google Cloud project ID") {
		t.Errorf("bad project: %d %s", rec.Code, rec.Body)
	}
}

func TestGKEImportWritesAPluginKubeconfigAndLoadsIt(t *testing.T) {
	d, sm, kc := unpinnedDiscoveryAPI(t)
	d.Run = fakeClouds
	before, _ := os.ReadFile(kc)
	rec := call(t, d.HandleGKEImport, http.MethodPost, `{"project":"shop-prod","location":"europe-west1","name":"web"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, ".kubebay", "discovered", "gke-shop-prod-europe-west1-web.yaml")
	st, err := os.Stat(path)
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("file: %v %v", err, st)
	}
	body, _ := os.ReadFile(path)
	if !strings.Contains(string(body), "gke-gcloud-auth-plugin") || strings.Contains(string(body), "token:") {
		t.Errorf("kubeconfig:\n%s", body)
	}
	set, _ := sm.Load()
	if len(set.ExtraKubeconfigs) != 1 || set.ExtraKubeconfigs[0] != path {
		t.Errorf("extraKubeconfigs = %v", set.ExtraKubeconfigs)
	}
	loaded := false
	for _, c := range sm.mgr.List() {
		loaded = loaded || c.Context == "gke_shop-prod_europe-west1_web"
	}
	if !loaded {
		t.Error("the imported context isn't loaded")
	}
	if after, _ := os.ReadFile(kc); string(after) != string(before) {
		t.Error("the user's own kubeconfig must never be written")
	}
	if rec := call(t, d.HandleGKEImport, http.MethodPost, `{"project":"shop-prod","location":"europe-west1","name":"web"}`); rec.Code != http.StatusConflict {
		t.Errorf("re-import: %d %s", rec.Code, rec.Body)
	}
}

func TestGKEImportExplainsAPinnedKubeconfigAndRejectsBadInput(t *testing.T) {
	d, _ := discoveryAPI(t)
	d.Run = fakeClouds
	rec := call(t, d.HandleGKEImport, http.MethodPost, `{"project":"shop-prod","location":"europe-west1","name":"web"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "gcloud container clusters get-credentials web --location europe-west1 --project shop-prod") {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
	for _, body := range []string{
		`{"project":"--x","location":"europe-west1","name":"web"}`,
		`{"project":"shop-prod","location":"--x","name":"web"}`,
		`{"project":"shop-prod","location":"europe-west1","name":"--x"}`,
	} {
		if rec := call(t, d.HandleGKEImport, http.MethodPost, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
}

func TestGKEDiscoveryIsDesktopOnlyAndBehindTheToken(t *testing.T) {
	d, _ := discoveryAPI(t)
	d.Run = fakeClouds
	d.Disabled = "off"
	for name, h := range map[string]http.HandlerFunc{"projects": d.HandleGCPProjects, "scan": d.HandleGKEScan, "import": d.HandleGKEImport} {
		if rec := call(t, h, http.MethodPost, `{"project":"shop-prod","location":"europe-west1","name":"web"}`); rec.Code != http.StatusForbidden {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	h := Router(Deps{Discovery: d}, "secret")
	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, "/api/discover/gcp/projects"},
		{http.MethodPost, "/api/discover/gke/scan"},
		{http.MethodPost, "/api/discover/gke/import"},
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
