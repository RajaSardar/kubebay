package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	rcommon "helm.sh/helm/v4/pkg/release/common"
	"helm.sh/helm/v4/pkg/storage"
	"helm.sh/helm/v4/pkg/storage/driver"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// ADR 0004 S6 (ADR 0003): an identity that can read release Secrets only in
// some namespaces lists those it named, one by one; a refused one is named,
// with the API server's reason, never silently dropped.
func TestNamedNamespacesAreListedEachAndTheRefusedNamed(t *testing.T) {
	cs := fake.NewClientset()
	for _, r := range []struct{ name, ns string }{{"web", "shop"}, {"api", "payments"}, {"db", "data"}} {
		if err := driver.NewSecrets(cs.CoreV1().Secrets(r.ns)).Create(fmt.Sprintf("sh.helm.release.v1.%s.v1", r.name), revision(r.name, r.ns, 1, rcommon.StatusDeployed)); err != nil {
			t.Fatal(err)
		}
	}
	const refusal = `User "dev" cannot list resource "secrets" in API group "" in the namespace "payments"`
	cs.PrependReactor("list", "secrets", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if a.GetNamespace() == "payments" {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "", errors.New(refusal))
		}
		return false, nil, nil
	})
	h := &HelmManager{store: func(_ *http.Request, _, ns string) (*storage.Storage, error) {
		return liveReleaseStore(cs.CoreV1().Secrets(ns)), nil
	}}

	rec := get(h.HandleReleases, "/api/helm/releases?cluster=c&ns=shop&ns=payments")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var got struct {
		Releases []ReleaseSummary `json:"releases"`
		Denied   []struct {
			NS      string `json:"ns"`
			Message string `json:"message"`
		} `json:"denied"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("%v: %s", err, rec.Body)
	}
	if len(got.Releases) != 1 || got.Releases[0].Name != "web" {
		t.Errorf("releases = %+v, want only shop's web (data wasn't named)", got.Releases)
	}
	if len(got.Denied) != 1 || got.Denied[0].NS != "payments" || !strings.Contains(got.Denied[0].Message, refusal) {
		t.Errorf("denied = %+v, want payments with the API server's reason", got.Denied)
	}
}

// Without named namespaces the list is the whole cluster's, in the same shape.
func TestTheClusterWideListHasTheSameShape(t *testing.T) {
	rec := get(memoryHelm(t, webRelease(1, rcommon.StatusDeployed)).HandleReleases, "/api/helm/releases?cluster=c")
	var got struct {
		Releases []ReleaseSummary `json:"releases"`
		Denied   []any            `json:"denied"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("%v: %s", err, rec.Body)
	}
	if len(got.Releases) != 1 || got.Releases[0].Name != "web" || got.Denied == nil || len(got.Denied) != 0 {
		t.Errorf("got %s", rec.Body)
	}
}
