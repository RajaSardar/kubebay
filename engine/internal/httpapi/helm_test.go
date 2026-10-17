package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"helm.sh/helm/v4/pkg/action"
	chartv2 "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/kube"
	"helm.sh/helm/v4/pkg/release/common"
	releasev1 "helm.sh/helm/v4/pkg/release/v1"
)

func TestSummarizeReportsTheApplyMethod(t *testing.T) {
	rel := func(method string) *releasev1.Release {
		return &releasev1.Release{
			Name:        "web",
			Namespace:   "team-a",
			Version:     3,
			Info:        &releasev1.Info{Status: common.StatusDeployed, LastDeployed: time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC), Description: "Upgrade complete"},
			Chart:       &chartv2.Chart{Metadata: &chartv2.Metadata{Name: "nginx", Version: "1.2.3", AppVersion: "1.27"}},
			Manifest:    "kind: ConfigMap",
			ApplyMethod: method,
		}
	}
	got := summarize(rel("ssa"))
	want := ReleaseSummary{
		Name: "web", Namespace: "team-a", Chart: "nginx", ChartVer: "1.2.3", AppVersion: "1.27",
		Status: "deployed", Revision: 3, Updated: "2026-10-17T09:00:00Z", Description: "Upgrade complete",
		Manifest: "kind: ConfigMap", ApplyMethod: "ssa",
	}
	if got != want {
		t.Errorf("summarize = %+v\nwant        %+v", got, want)
	}
	// Helm 3 never set the field, and it always applied client-side.
	if got := summarize(rel("")).ApplyMethod; got != "csa" {
		t.Errorf("a release Helm 3 wrote: applyMethod = %q, want csa", got)
	}
}

func TestSummarizeAReleaseOfAnUnknownType(t *testing.T) {
	if got := summarize("not a release"); got.Status != "unknown" {
		t.Errorf("summarize(string) = %+v, want status unknown", got)
	}
	var nilRel *releasev1.Release
	if got := summarize(nilRel); got.Status != "unknown" {
		t.Errorf("summarize(nil) = %+v, want status unknown", got)
	}
}

// Helm 4 refuses to run an action without a wait strategy. Kubebay never waited
// for resources (Helm 3 without --wait), so every action waits for hooks only.
func TestHelmActionsWaitForHooksOnly(t *testing.T) {
	cfg := action.NewConfiguration()
	up := HelmUpgradeRequest{Cluster: "c", NS: "team-a", Name: "web", ChartRef: "repo/nginx", Version: "1.2.3"}
	cpo := action.ChartPathOptions{Version: up.Version}

	inst := helmInstall(cfg, up, cpo)
	if inst.WaitStrategy != kube.HookOnlyStrategy {
		t.Errorf("install wait = %q, want %q", inst.WaitStrategy, kube.HookOnlyStrategy)
	}
	if !inst.ServerSideApply {
		t.Error("install should keep Helm 4's server-side apply")
	}
	if inst.ReleaseName != "web" || inst.Namespace != "team-a" || !inst.CreateNamespace || inst.Timeout != 5*time.Minute || inst.Version != "1.2.3" {
		t.Errorf("install = %+v", inst)
	}
	if inst.DryRunStrategy != action.DryRunNone {
		t.Errorf("install dry run = %q, want none", inst.DryRunStrategy)
	}
	if inst.PostRenderer == nil {
		t.Error("install has no post-renderer (stripComplianceSpecs)")
	}

	upg := helmUpgrade(cfg, up, cpo)
	if upg.WaitStrategy != kube.HookOnlyStrategy {
		t.Errorf("upgrade wait = %q, want %q", upg.WaitStrategy, kube.HookOnlyStrategy)
	}
	if upg.ServerSideApply != "auto" {
		t.Errorf("upgrade apply = %q, want auto (keep the release's method)", upg.ServerSideApply)
	}
	if upg.Namespace != "team-a" || upg.Timeout != 5*time.Minute || upg.DryRunStrategy != action.DryRunNone || upg.PostRenderer == nil {
		t.Errorf("upgrade = %+v", upg)
	}

	rb := helmRollback(cfg, HelmActionRequest{Cluster: "c", NS: "team-a", Name: "web", Revision: 2})
	if rb.WaitStrategy != kube.HookOnlyStrategy || rb.Version != 2 || rb.Timeout != 5*time.Minute || rb.ServerSideApply != "auto" {
		t.Errorf("rollback = %+v", rb)
	}

	un := helmUninstall(cfg)
	if un.WaitStrategy != kube.HookOnlyStrategy || un.Timeout != 5*time.Minute {
		t.Errorf("uninstall = %+v", un)
	}
}

// A preview renders client-side only: it never contacts the API server.
func TestHelmDryRunIsClientSide(t *testing.T) {
	cfg := action.NewConfiguration()
	up := HelmUpgradeRequest{Cluster: "c", NS: "team-a", Name: "web", ChartRef: "repo/nginx", DryRun: true}
	if got := helmInstall(cfg, up, action.ChartPathOptions{}).DryRunStrategy; got != action.DryRunClient {
		t.Errorf("install dry run = %q, want client", got)
	}
	if got := helmUpgrade(cfg, up, action.ChartPathOptions{}).DryRunStrategy; got != action.DryRunClient {
		t.Errorf("upgrade dry run = %q, want client", got)
	}
}

// The install dialog prefills a chart's default values; a local chart path is
// a valid ref.
func TestHandleChartValuesReadsTheChartDefaults(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "kb-hello")
	if err := os.MkdirAll(filepath.Join(dir, "templates"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"Chart.yaml":  "apiVersion: v2\nname: kb-hello\nversion: 0.1.0\n",
		"values.yaml": "greeting: hello\nreplicas: 2\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	rec := httptest.NewRecorder()
	(&HelmManager{}).HandleChartValues(rec, httptest.NewRequest(http.MethodGet, "/api/helm/chart-values?ref="+url.QueryEscape(dir), nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if body := rec.Body.String(); !strings.Contains(body, "greeting: hello") || !strings.Contains(body, "replicas: 2") {
		t.Errorf("values = %q", body)
	}
}
