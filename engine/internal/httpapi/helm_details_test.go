package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/chart/common"
	kubefake "helm.sh/helm/v4/pkg/kube/fake"
	rcommon "helm.sh/helm/v4/pkg/release/common"
	releasev1 "helm.sh/helm/v4/pkg/release/v1"
	"helm.sh/helm/v4/pkg/storage"
	"helm.sh/helm/v4/pkg/storage/driver"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// ADR 0004 S7: a release's details are what it created, its hooks and its
// notes, read with Helm's own Get as the person signed in, and never what
// those objects hold.

const detailsManifest = `---
# Source: web/templates/deploy.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec: {}
---
# Source: web/templates/svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: web
---
# Source: web/templates/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: web-db
stringData:
  password: hunter2
---
# Source: web/templates/role.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: web-reader
---
# Source: web/templates/widget.yaml
apiVersion: example.com/v1
kind: Widget
metadata:
  name: gizmo
  namespace: other
`

func detailedRelease() *releasev1.Release {
	r := webRelease(3, rcommon.StatusDeployed)
	r.Manifest = detailsManifest
	r.Config = map[string]any{"db": map[string]any{"password": "s3cret-value"}}
	r.Info.Notes = "Connect with password=abcd1234 at web.shop.svc"
	at := time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)
	r.Hooks = []*releasev1.Hook{{
		Name:           "web-migrate",
		Kind:           "Job",
		Events:         []releasev1.HookEvent{releasev1.HookPreInstall},
		DeletePolicies: []releasev1.HookDeletePolicy{releasev1.HookSucceeded},
		Manifest:       "kind: Job\nmetadata:\n  name: web-migrate\n# password: hookpass\n",
		LastRun:        releasev1.HookExecution{StartedAt: at, CompletedAt: at.Add(30 * time.Second), Phase: releasev1.HookPhaseSucceeded},
	}}
	return r
}

// The kinds this cluster serves; Widget's CRD was removed.
func servedKinds() meta.RESTMapper {
	m := meta.NewDefaultRESTMapper(nil)
	m.Add(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}, meta.RESTScopeNamespace)
	m.Add(schema.GroupVersionKind{Version: "v1", Kind: "Service"}, meta.RESTScopeNamespace)
	m.Add(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, meta.RESTScopeNamespace)
	m.Add(schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole"}, meta.RESTScopeRoot)
	return m
}

func TestReleaseDetailsListWhatItCreatedAndNeverWhatItHolds(t *testing.T) {
	h := memoryHelm(t, detailedRelease())
	h.mapper = func(*http.Request, string) (meta.RESTMapper, error) { return servedKinds(), nil }
	rec := get(h.HandleRelease, "/api/helm/release?cluster=c&ns=shop&name=web")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	body := rec.Body.String()
	for _, leak := range []string{"hunter2", "s3cret-value", "abcd1234", "hookpass", `"manifest"`} {
		if strings.Contains(body, leak) {
			t.Errorf("the details send %s: %s", leak, body)
		}
	}
	var got ReleaseDetails
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Release.Name != "web" || got.Release.Revision != 3 || got.Release.Status != "deployed" || got.Release.Chart != "web" {
		t.Errorf("release = %+v", got.Release)
	}
	wantResources := []ReleaseResource{
		{APIVersion: "apps/v1", Kind: "Deployment", Resource: "deployments", Namespace: "shop", Name: "web", Namespaced: true, Served: true},
		{APIVersion: "v1", Kind: "Service", Resource: "services", Namespace: "shop", Name: "web", Namespaced: true, Served: true},
		{APIVersion: "v1", Kind: "Secret", Resource: "secrets", Namespace: "shop", Name: "web-db", Namespaced: true, Served: true},
		{APIVersion: "rbac.authorization.k8s.io/v1", Kind: "ClusterRole", Resource: "clusterroles", Name: "web-reader", Served: true},
		{APIVersion: "example.com/v1", Kind: "Widget", Namespace: "other", Name: "gizmo", Namespaced: true, Served: false},
	}
	if !reflect.DeepEqual(got.Resources, wantResources) {
		t.Errorf("resources:\n%+v\nwant\n%+v", got.Resources, wantResources)
	}
	if len(got.Hooks) != 1 {
		t.Fatalf("hooks = %+v", got.Hooks)
	}
	hk := got.Hooks[0]
	if hk.Kind != "Job" || hk.Name != "web-migrate" || hk.Phase != "Succeeded" ||
		!reflect.DeepEqual(hk.Events, []string{"pre-install"}) || !reflect.DeepEqual(hk.DeletePolicies, []string{"hook-succeeded"}) ||
		hk.StartedAt != "2026-10-28T09:00:00Z" || hk.CompletedAt != "2026-10-28T09:00:30Z" {
		t.Errorf("hook = %+v", hk)
	}
	if !strings.Contains(got.Notes, "password=<redacted>") || !strings.Contains(got.Notes, "web.shop.svc") {
		t.Errorf("notes = %q", got.Notes)
	}
}

func TestReleaseDetailsSayWhenTheReleaseCantBeRead(t *testing.T) {
	cs := fake.NewClientset()
	const refusal = `User "dev" cannot list resource "secrets" in API group "" in the namespace "shop"`
	cs.PrependReactor("list", "secrets", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "", errors.New(refusal))
	})
	cfg := &action.Configuration{
		Releases:     storage.Init(driver.NewSecrets(cs.CoreV1().Secrets("shop"))),
		KubeClient:   &kubefake.PrintingKubeClient{Out: io.Discard},
		Capabilities: common.DefaultCapabilities,
	}
	h := &HelmManager{
		config: func(*http.Request, string, string) (*action.Configuration, error) { return cfg, nil },
		mapper: func(*http.Request, string) (meta.RESTMapper, error) { return servedKinds(), nil },
	}
	rec := get(h.HandleRelease, "/api/helm/release?cluster=c&ns=shop&name=web")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), refusal) {
		t.Errorf("status %d: %s", rec.Code, rec.Body)
	}
}
