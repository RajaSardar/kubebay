package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/chart/common"
	chartv2 "helm.sh/helm/v4/pkg/chart/v2"
	kubefake "helm.sh/helm/v4/pkg/kube/fake"
	rcommon "helm.sh/helm/v4/pkg/release/common"
	releasev1 "helm.sh/helm/v4/pkg/release/v1"
	"helm.sh/helm/v4/pkg/storage"
	"helm.sh/helm/v4/pkg/storage/driver"
)

// ADR 0004 S1: a release's rendered manifest can hold Secrets, so lists and
// history never carry it, and the Manifest tab masks Secret values.

const secretManifest = `---
# Source: web/templates/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: web-db
type: Opaque
data:
  password: aHVudGVyMg==
stringData:
  token: hunter2
---
# Source: web/templates/cm.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
data:
  greeting: hello
`

// memoryHelm is a HelmManager whose Helm actions use Helm's in-memory storage
// and a fake Kubernetes client, holding the given releases.
func memoryHelm(t *testing.T, rels ...*releasev1.Release) *HelmManager {
	t.Helper()
	store := storage.Init(driver.NewMemory())
	for _, r := range rels {
		if err := store.Create(r); err != nil {
			t.Fatal(err)
		}
	}
	cfg := &action.Configuration{
		Releases:     store,
		KubeClient:   &kubefake.PrintingKubeClient{Out: io.Discard},
		Capabilities: common.DefaultCapabilities,
	}
	return &HelmManager{
		config: func(*http.Request, string, string) (*action.Configuration, error) { return cfg, nil },
		store:  func(*http.Request, string, string) (*storage.Storage, error) { return store, nil },
	}
}

func webRelease(version int, status rcommon.Status) *releasev1.Release {
	return &releasev1.Release{
		Name:      "web",
		Namespace: "shop",
		Version:   version,
		Info:      &releasev1.Info{Status: status, LastDeployed: time.Date(2026, 10, 28, 9, 0, version, 0, time.UTC)},
		Chart:     &chartv2.Chart{Metadata: &chartv2.Metadata{Name: "web", Version: "1.0.0", AppVersion: "2.0"}},
		Manifest:  secretManifest,
	}
}

func get(h http.HandlerFunc, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestReleaseListsCarryNoManifests(t *testing.T) {
	h := memoryHelm(t, webRelease(1, rcommon.StatusSuperseded), webRelease(2, rcommon.StatusDeployed))
	for path, handler := range map[string]http.HandlerFunc{
		"/api/helm/releases?cluster=c":                 h.HandleReleases,
		"/api/helm/history?cluster=c&ns=shop&name=web": h.HandleHistory,
	} {
		rec := get(handler, path)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d: %s", path, rec.Code, rec.Body)
		}
		body := rec.Body.String()
		if !strings.Contains(body, `"name":"web"`) {
			t.Errorf("%s: the release is missing: %s", path, body)
		}
		for _, leak := range []string{`"manifest"`, "aHVudGVyMg==", "hunter2"} {
			if strings.Contains(body, leak) {
				t.Errorf("%s sends %s: %s", path, leak, body)
			}
		}
	}
}

// The install and upgrade preview shows what would be applied, so the
// upgrade response still carries the manifest (the installers read it).
func TestAnUpgradeResultStillCarriesItsManifest(t *testing.T) {
	if got := summarize(webRelease(2, rcommon.StatusDeployed)).Manifest; got != secretManifest {
		t.Errorf("summarize dropped the manifest the install preview shows")
	}
}

func TestTheManifestTabMasksSecretValues(t *testing.T) {
	h := memoryHelm(t, webRelease(1, rcommon.StatusDeployed))
	rec := get(h.HandleManifest, "/api/helm/manifest?cluster=c&ns=shop&name=web")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	body := rec.Body.String()
	for _, leak := range []string{"aHVudGVyMg==", "hunter2"} {
		if strings.Contains(body, leak) {
			t.Errorf("the manifest shows %s:\n%s", leak, body)
		}
	}
	for _, kept := range []string{"# Source: web/templates/secret.yaml", "name: web-db", "password:", "token:", "<redacted>"} {
		if !strings.Contains(body, kept) {
			t.Errorf("the masked Secret lost %q:\n%s", kept, body)
		}
	}
	cm := secretManifest[strings.Index(secretManifest, "# Source: web/templates/cm.yaml"):]
	if !strings.Contains(body, cm) {
		t.Errorf("a document that isn't a Secret changed:\n%s", body)
	}
}

func TestMaskSecretValuesLeavesOtherManifestsAlone(t *testing.T) {
	plain := "---\n# Source: a.yaml\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\ndata:\n  password: shown-because-it-is-a-configmap\n"
	if got := maskSecretValues(plain); got != plain {
		t.Errorf("maskSecretValues changed a manifest without Secrets:\n%s", got)
	}
	if got := maskSecretValues(""); got != "" {
		t.Errorf("maskSecretValues(\"\") = %q", got)
	}
}
