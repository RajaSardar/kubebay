package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// "hunter2" in base64, the way the API server stores it.
const secretB64 = "aHVudGVyMg=="

func liveSecret() *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]interface{}{
			"name":      "db-creds",
			"namespace": "shop",
			"labels":    map[string]interface{}{"tier": "db"},
			"annotations": map[string]interface{}{
				// kubectl apply keeps the whole manifest here, values included.
				"kubectl.kubernetes.io/last-applied-configuration": `{"data":{"password":"` + secretB64 + `"}}`,
				"team": "payments",
			},
		},
		"type": "Opaque",
		"data": map[string]interface{}{"password": secretB64, "user": "YWRtaW4="},
	}}
}

func getSecret(t *testing.T, c *Channels, extra string) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	c.HandleGetYAML(rr, httptest.NewRequest(http.MethodGet, "/api/yaml?cluster=c1&gvr=v1/secrets&ns=shop&name=db-creds"+extra, nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	return rr
}

// A Secret opened in the editor or the drawer shows which keys it holds, not
// what they hold: values arrive only through an explicit, audited reveal.
func TestGetYAMLMasksASecretsValuesButKeepsItsKeys(t *testing.T) {
	c, _ := editChannels(t, liveSecret())
	for _, format := range []string{"", "&format=json"} {
		body := getSecret(t, c, format).Body.String()
		if strings.Contains(body, secretB64) || strings.Contains(body, "YWRtaW4=") {
			t.Errorf("format %q leaks a Secret value:\n%s", format, body)
		}
		for _, key := range []string{"password", "user", "team"} {
			if !strings.Contains(body, key) {
				t.Errorf("format %q lost %q:\n%s", format, key, body)
			}
		}
	}
}

// last-applied-configuration is a second copy of the manifest, data included.
func TestGetYAMLMasksTheLastAppliedCopyOfASecret(t *testing.T) {
	c, _ := editChannels(t, liveSecret())
	body := getSecret(t, c, "").Body.String()
	if strings.Contains(body, secretB64) {
		t.Fatalf("the last-applied annotation leaks the value:\n%s", body)
	}
	if !strings.Contains(body, "team: payments") {
		t.Errorf("other annotations must stay:\n%s", body)
	}
}

func TestGetYAMLRevealReturnsTheValuesAndIsAudited(t *testing.T) {
	c, _ := editChannels(t, liveSecret())
	body := getSecret(t, c, "&reveal=true").Body.String()
	if !strings.Contains(body, secretB64) {
		t.Fatalf("reveal should return the stored values:\n%s", body)
	}
	entries, err := c.Audit.Tail(10)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if e.Action == "secret-reveal" && e.Resource == "db-creds" && e.Namespace == "shop" {
			found = true
		}
	}
	if !found {
		t.Errorf("a reveal must leave a secret-reveal audit entry, got %+v", entries)
	}
}

func TestGetYAMLMaskingDoesNotTouchOtherKinds(t *testing.T) {
	c, _ := editChannels(t, liveForGet())
	body := getYAMLWith(t, c)
	if strings.Contains(body, "hidden") {
		t.Errorf("a Deployment must not be masked:\n%s", body)
	}
}

func getYAMLWith(t *testing.T, c *Channels) string {
	t.Helper()
	rr := httptest.NewRecorder()
	c.HandleGetYAML(rr, httptest.NewRequest(http.MethodGet, "/api/yaml?cluster=c1&gvr=apps/v1/deployments&ns=shop&name=api", nil))
	return rr.Body.String()
}

func secretEditBody(original, modified string) map[string]interface{} {
	return map[string]interface{}{
		"cluster": "c1", "gvr": "v1/secrets", "ns": "shop", "name": "db-creds",
		"yaml": modified, "original": original, "dryRun": false, "force": false,
	}
}

const maskedSecretYAML = `apiVersion: v1
kind: Secret
metadata:
  name: db-creds
  namespace: shop
  labels:
    tier: %s
data:
  password: %s
`

// The editor saves by diffing what it loaded against what you changed. A value
// edited while still masked has nothing real to diff from, so it is refused
// rather than written over the stored one.
func TestApplyYAMLRefusesAnEditOfAStillMaskedSecretValue(t *testing.T) {
	c, got := editChannels(t, liveSecret())
	original := strings.Replace(strings.Replace(maskedSecretYAML, "%s", "db", 1), "%s", secretMask, 1)
	edited := strings.Replace(strings.Replace(maskedSecretYAML, "%s", "db", 1), "%s", "bmV3LXZhbHVl", 1)
	rr, _ := putYAML(t, c, secretEditBody(original, edited))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(strings.ToLower(rr.Body.String()), "hidden") {
		t.Errorf("the error should say the values are hidden and how to edit them: %s", rr.Body.String())
	}
	if got.called {
		t.Error("nothing may be sent to the cluster")
	}
}

// Editing a label on a masked Secret is fine: the placeholder is unchanged on
// both sides, so it is not in the patch.
func TestApplyYAMLAllowsEditingAMaskedSecretsLabelsWithoutWritingThePlaceholder(t *testing.T) {
	c, got := editChannels(t, liveSecret())
	original := strings.Replace(strings.Replace(maskedSecretYAML, "%s", "db", 1), "%s", secretMask, 1)
	edited := strings.Replace(strings.Replace(maskedSecretYAML, "%s", "api", 1), "%s", secretMask, 1)
	rr, _ := putYAML(t, c, secretEditBody(original, edited))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if !got.called {
		t.Fatal("the label change should reach the cluster")
	}
	if strings.Contains(string(got.action.GetPatch()), secretMask) {
		t.Errorf("the placeholder must never be written: %s", got.action.GetPatch())
	}
}
