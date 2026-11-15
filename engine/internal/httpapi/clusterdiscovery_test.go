package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clouddiscovery"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// fakeEKS stands in for the user's aws CLI: two clusters in eu-west-1.
func fakeEKS(_ context.Context, _ string, args ...string) ([]byte, error) {
	joined := strings.Join(args, " ")
	switch {
	case strings.HasPrefix(joined, "configure list-profiles"):
		return []byte("work\n"), nil
	case strings.HasPrefix(joined, "configure get region --profile work"):
		return []byte("eu-west-1\n"), nil
	case strings.HasPrefix(joined, "eks list-clusters --region eu-west-1"):
		return []byte(`{"clusters":["dev","prod"]}`), nil
	case strings.HasPrefix(joined, "eks describe-cluster --name "):
		name := strings.Fields(strings.TrimPrefix(joined, "eks describe-cluster --name "))[0]
		return []byte(fmt.Sprintf(`{"cluster":{"name":%q,"arn":"arn:aws:eks:eu-west-1:111122223333:cluster/%s","endpoint":"https://%s.example","certificateAuthority":{"data":"Q0EtREFUQQ=="},"status":"ACTIVE","version":"1.31"}}`, name, name, name)), nil
	}
	return nil, fmt.Errorf("unexpected aws %s", joined)
}

func discoveryAPI(t *testing.T) (*DiscoveryAPI, *SettingsManager) {
	t.Helper()
	sm := settingsWithManager(t)
	return &DiscoveryAPI{Settings: sm, Clusters: sm.mgr, Run: fakeEKS}, sm
}

// unpinnedDiscoveryAPI uses the default loading rules (here $KUBECONFIG, a
// throwaway file), the desktop app's normal mode, where extra kubeconfigs load.
func unpinnedDiscoveryAPI(t *testing.T) (*DiscoveryAPI, *SettingsManager, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("KUBEBAY_KUBECONFIG", "")
	kc := filepath.Join(home, "kubeconfig")
	cfg := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://127.0.0.1:1\ncontexts:\n- name: kind-dev\n  context:\n    cluster: c\n    user: u\nusers:\n- name: u\n  user: {}\ncurrent-context: kind-dev\n"
	if err := os.WriteFile(kc, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KUBECONFIG", kc)
	mgr, err := clusters.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	if err != nil {
		t.Fatal(err)
	}
	sm := NewSettingsManager(mgr)
	return &DiscoveryAPI{Settings: sm, Clusters: mgr, Run: fakeEKS}, sm, kc
}

func call(t *testing.T, h http.HandlerFunc, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(method, "/x", strings.NewReader(body)))
	return rec
}

func TestDiscoveryListsAWSProfiles(t *testing.T) {
	d, _ := discoveryAPI(t)
	rec := call(t, d.HandleProfiles, http.MethodGet, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `{"name":"work","region":"eu-west-1"}`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestDiscoveryScanMarksClustersAlreadyInAKubeconfig(t *testing.T) {
	d, sm := discoveryAPI(t)
	// The user's kubeconfig already has prod, under the AWS CLI's ARN naming.
	kc := os.Getenv("KUBEBAY_KUBECONFIG")
	b, _ := os.ReadFile(kc)
	withProd := strings.Replace(string(b), "contexts:\n", "contexts:\n- name: arn:aws:eks:eu-west-1:111122223333:cluster/prod\n  context:\n    cluster: c\n    user: u\n", 1)
	if err := os.WriteFile(kc, []byte(withProd), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := sm.mgr.Load(); err != nil {
		t.Fatal(err)
	}
	rec := call(t, d.HandleScan, http.MethodPost, `{"profile":"work","regions":["eu-west-1"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var got struct {
		Clusters []struct {
			Name     string `json:"name"`
			Imported bool   `json:"imported"`
			CAData   string `json:"caData"`
		} `json:"clusters"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got.Clusters) != 2 || got.Clusters[0].Name != "dev" || got.Clusters[0].Imported || !got.Clusters[1].Imported {
		t.Errorf("clusters = %+v", got.Clusters)
	}
	if strings.Contains(rec.Body.String(), "Q0EtREFUQQ") {
		t.Error("the CA isn't sent to the browser; import describes the cluster again")
	}
}

func TestDiscoveryImportWritesAKubebayOwnedKubeconfigAndLoadsIt(t *testing.T) {
	d, sm, kc := unpinnedDiscoveryAPI(t)
	userKubeconfig, _ := os.ReadFile(kc)
	rec := call(t, d.HandleImport, http.MethodPost, `{"profile":"work","region":"eu-west-1","name":"dev"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, ".kubebay", "discovered", "eks-work-eu-west-1-dev.yaml")
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v, want 0600", st.Mode().Perm())
	}
	body, _ := os.ReadFile(path)
	if !strings.Contains(string(body), "get-token") || !strings.Contains(string(body), "AWS_PROFILE") {
		t.Errorf("kubeconfig:\n%s", body)
	}
	set, _ := sm.Load()
	if len(set.ExtraKubeconfigs) != 1 || set.ExtraKubeconfigs[0] != path {
		t.Errorf("extraKubeconfigs = %v", set.ExtraKubeconfigs)
	}
	found := false
	for _, c := range sm.mgr.List() {
		if c.Context == "arn:aws:eks:eu-west-1:111122223333:cluster/dev" {
			found = true
		}
	}
	if !found {
		t.Error("the imported context isn't loaded")
	}
	if after, _ := os.ReadFile(kc); string(after) != string(userKubeconfig) {
		t.Error("the user's own kubeconfig must never be written")
	}
	// A second import of the same cluster is refused, not duplicated.
	if rec := call(t, d.HandleImport, http.MethodPost, `{"profile":"work","region":"eu-west-1","name":"dev"}`); rec.Code != http.StatusConflict {
		t.Errorf("re-import: %d %s", rec.Code, rec.Body)
	}
}

func TestDiscoveryKeepsOtherSettingsWhenImporting(t *testing.T) {
	d, sm, _ := unpinnedDiscoveryAPI(t)
	save(t, sm, `{"prometheusUrls":{"kind-dev":"http://127.0.0.1:9090"},"nodeShellImage":"busybox:1"}`)
	if rec := call(t, d.HandleImport, http.MethodPost, `{"profile":"work","region":"eu-west-1","name":"dev"}`); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	set, _ := sm.Load()
	if set.PrometheusURLs["kind-dev"] == "" || set.NodeShellImage != "busybox:1" {
		t.Errorf("import lost settings: %+v", set)
	}
}

// A pinned engine (KUBEBAY_KUBECONFIG, the prod-safety override) loads only
// that file, so an import would report success and never show up.
func TestDiscoveryImportExplainsAPinnedKubeconfig(t *testing.T) {
	d, _ := discoveryAPI(t)
	rec := call(t, d.HandleImport, http.MethodPost, `{"profile":"work","region":"eu-west-1","name":"dev"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "aws eks update-kubeconfig --name dev --region eu-west-1 --kubeconfig") {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

func TestDiscoveryRejectsBadInput(t *testing.T) {
	d, _ := discoveryAPI(t)
	for _, body := range []string{`{"profile":"--debug","region":"eu-west-1","name":"dev"}`, `{"region":"eu-west-1","name":"--x"}`, `{"region":"nowhere","name":"dev"}`} {
		if rec := call(t, d.HandleImport, http.MethodPost, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	if rec := call(t, d.HandleScan, http.MethodPost, `{"regions":[]}`); rec.Code != http.StatusBadRequest {
		t.Errorf("scan with no region: %d", rec.Code)
	}
}

// Discovery runs the CLI with the engine host's own credentials, which in
// server mode belong to no logged-in user.
func TestDiscoveryIsDesktopOnly(t *testing.T) {
	d, _ := discoveryAPI(t)
	d.Disabled = "off"
	for name, h := range map[string]http.HandlerFunc{"profiles": d.HandleProfiles, "scan": d.HandleScan, "import": d.HandleImport} {
		if rec := call(t, h, http.MethodPost, `{"region":"eu-west-1","name":"dev","regions":["eu-west-1"]}`); rec.Code != http.StatusForbidden {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	if DiscoveryBlockReason(false, true) == "" || DiscoveryBlockReason(true, false) == "" || DiscoveryBlockReason(false, false) != "" {
		t.Error("blocked with OIDC or in-cluster only")
	}
}

var _ = time.Second
var _ clouddiscovery.Runner = fakeEKS

// The routes sit behind the launch token like every other mutating route.
func TestDiscoveryRoutesNeedTheToken(t *testing.T) {
	d, _ := discoveryAPI(t)
	d.Disabled = "off for this test"
	h := Router(Deps{Discovery: d}, "secret")
	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, "/api/discover/aws/profiles"},
		{http.MethodPost, "/api/discover/eks/scan"},
		{http.MethodPost, "/api/discover/eks/import"},
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
			t.Errorf("%s %s with the token reaches the handler (403 while disabled): %d", rt.method, rt.path, rec.Code)
		}
	}
}
