package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/dynamic"
	dynfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

const createDoc = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-lockdown
  namespace: shop
spec:
  podSelector: {}
  policyTypes: ["Ingress"]
`

func createChannels(t *testing.T, patchErr error) (*Channels, *capturedPatch) {
	t.Helper()
	c, got := editChannels(t)
	client := dynfake.NewSimpleDynamicClient(runtime.NewScheme())
	client.PrependReactor("patch", "*", func(a k8stesting.Action) (bool, runtime.Object, error) {
		got.action = a.(k8stesting.PatchActionImpl)
		got.called = true
		return true, nil, patchErr
	})
	c.dynOverride = func(context.Context, string) (dynamic.Interface, error) { return capDyn{client, got}, nil }
	fd := &fakediscovery.FakeDiscovery{Fake: &k8stesting.Fake{}}
	fd.Resources = []*metav1.APIResourceList{{
		GroupVersion: "networking.k8s.io/v1",
		APIResources: []metav1.APIResource{{Name: "networkpolicies", Kind: "NetworkPolicy", Namespaced: true}},
	}}
	c.discoOverride = func(context.Context, string) (discovery.DiscoveryInterface, error) { return fd, nil }
	return c, got
}

func postCreate(t *testing.T, c *Channels) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"cluster": "c1", "yaml": createDoc, "dryRun": false})
	rr := httptest.NewRecorder()
	c.HandleCreateResource(rr, httptest.NewRequest(http.MethodPost, "/api/yaml/create", bytes.NewReader(b)))
	return rr
}

func TestCreateDoesNotForceOwnership(t *testing.T) {
	c, got := createChannels(t, nil)
	rr := postCreate(t, c)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	if got.opts.FieldManager != "kubebay" {
		t.Errorf("field manager = %q", got.opts.FieldManager)
	}
	if got.opts.Force != nil && *got.opts.Force {
		t.Error("create must not force: an existing object's fields owned by other tools are theirs")
	}
}

func TestCreateOverAnObjectOthersManageExplainsWhatToDo(t *testing.T) {
	conflict := apierrors.NewApplyConflict(
		[]metav1.StatusCause{{Type: metav1.CauseTypeFieldManagerConflict, Message: `conflict with "helm"`, Field: ".spec.podSelector"}},
		`Apply failed with 1 conflict: conflict with "helm": .spec.podSelector`,
	)
	c, _ := createChannels(t, conflict)
	rr := postCreate(t, c)
	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, want := range []string{"NetworkPolicy shop/db-lockdown already exists", "YAML tab", `conflict with "helm"`} {
		if !strings.Contains(body, want) {
			t.Errorf("body %q should contain %q", body, want)
		}
	}
}

func TestCreateKeepsOtherErrorsAsTheyWere(t *testing.T) {
	c, _ := createChannels(t, errors.New("dial tcp: connection refused"))
	rr := postCreate(t, c)
	if rr.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", rr.Code)
	}
}
