package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/chart/common"
	kubefake "helm.sh/helm/v4/pkg/kube/fake"
	"helm.sh/helm/v4/pkg/storage"
	"helm.sh/helm/v4/pkg/storage/driver"
)

// The store's Preview shows the manifest an install would apply. A Secret in
// it must not reach the browser with its values, as in the Manifest tab.
func TestDryRunPreviewMasksSecretValues(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "kb-secret")
	if err := os.MkdirAll(filepath.Join(dir, "templates"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"Chart.yaml":            "apiVersion: v2\nname: kb-secret\nversion: 0.1.0\n",
		"values.yaml":           "token: hunter2\n",
		"templates/secret.yaml": "apiVersion: v1\nkind: Secret\nmetadata:\n  name: s\ntype: Opaque\nstringData:\n  token: {{ .Values.token }}\n",
		"templates/cm.yaml":     "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\ndata:\n  mode: plain\n",
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cfg := &action.Configuration{
		Releases:     storage.Init(driver.NewMemory()),
		KubeClient:   &kubefake.PrintingKubeClient{Out: io.Discard},
		Capabilities: common.DefaultCapabilities,
	}
	h := &HelmManager{config: func(*http.Request, string, string) (*action.Configuration, error) { return cfg, nil }}
	body := `{"cluster":"c","ns":"default","name":"x","chartRef":` + jsonString(dir) + `,"valuesYaml":"token: hunter2\n","dryRun":true}`
	rec := httptest.NewRecorder()
	h.HandleUpgrade(rec, httptest.NewRequest(http.MethodPost, "/api/helm/upgrade", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var rel struct {
		Manifest string `json:"manifest"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &rel); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rel.Manifest, "hunter2") {
		t.Errorf("the preview carries a Secret's value:\n%s", rel.Manifest)
	}
	if !strings.Contains(rel.Manifest, "mode: plain") || !strings.Contains(rel.Manifest, "token:") {
		t.Errorf("the preview lost the rest of the manifest:\n%s", rel.Manifest)
	}
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
