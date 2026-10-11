package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func liveForGet() *unstructured.Unstructured {
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       "Deployment",
		"metadata": map[string]interface{}{
			"name":              "api",
			"namespace":         "shop",
			"uid":               "d-1",
			"creationTimestamp": "2026-09-01T00:00:00Z",
			"resourceVersion":   "42",
			"generation":        int64(3),
			"managedFields":     []interface{}{map[string]interface{}{"manager": "kubectl"}},
		},
	}}
	return u
}

func getYAML(t *testing.T, format string) *httptest.ResponseRecorder {
	t.Helper()
	c, _ := editChannels(t, liveForGet())
	q := "/api/yaml?cluster=c1&gvr=apps/v1/deployments&ns=shop&name=api"
	if format != "" {
		q += "&format=" + format
	}
	rr := httptest.NewRecorder()
	c.HandleGetYAML(rr, httptest.NewRequest(http.MethodGet, q, nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	return rr
}

// The drawer reads the JSON form, and matches a Deployment's ReplicaSets by
// its uid and shows when it was created, so those two stay in.
func TestGetYAMLAsJSONKeepsUIDAndCreationTimestamp(t *testing.T) {
	var doc struct {
		Metadata map[string]interface{} `json:"metadata"`
	}
	if err := json.Unmarshal(getYAML(t, "json").Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Metadata["uid"] != "d-1" {
		t.Errorf("uid = %v, want d-1", doc.Metadata["uid"])
	}
	if doc.Metadata["creationTimestamp"] != "2026-09-01T00:00:00Z" {
		t.Errorf("creationTimestamp = %v", doc.Metadata["creationTimestamp"])
	}
	for _, k := range []string{"managedFields", "resourceVersion"} {
		if _, ok := doc.Metadata[k]; ok {
			t.Errorf("%s should still be stripped", k)
		}
	}
}

// The editor's YAML stays free of fields no one edits.
func TestGetYAMLStillStripsServerFieldsFromTheEditorText(t *testing.T) {
	body := getYAML(t, "").Body.String()
	for _, k := range []string{"uid:", "creationTimestamp:", "resourceVersion:", "managedFields:", "generation:"} {
		if strings.Contains(body, k) {
			t.Errorf("YAML contains %q:\n%s", k, body)
		}
	}
	if !strings.Contains(body, "name: api") {
		t.Errorf("YAML lost the object:\n%s", body)
	}
}
