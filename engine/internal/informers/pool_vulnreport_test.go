package informers

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func vulnReport(kind string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"kind":     kind,
		"metadata": map[string]any{"name": "r"},
		"report": map[string]any{
			"updateTimestamp": "2026-01-01T00:00:00Z",
			"artifact":        map[string]any{"repository": "nginx", "tag": "1.25"},
			"vulnerabilities": []any{
				map[string]any{
					"vulnerabilityID": "CVE-1", "severity": "HIGH", "resource": "openssl",
					"installedVersion": "1", "fixedVersion": "2", "primaryLink": "https://x",
					"title": "t", "description": "a very long description", "links": []any{"a", "b"},
					"cvss": map[string]any{"nvd": map[string]any{"V3Score": 7.5}}, "score": 7.5,
					"target": "nginx:1.25", "class": "os-pkgs", "publishedDate": "d",
				},
			},
		},
	}}
}

// A real report carries a description, links and CVSS per CVE, and a cluster
// holds thousands of them; the UI reads six fields.
func TestTrimKeepsOnlyWhatTheVulnerabilityViewsRead(t *testing.T) {
	out, _ := trimManagedFields(vulnReport("VulnerabilityReport"))
	vulns := out.(*unstructured.Unstructured).Object["report"].(map[string]any)["vulnerabilities"].([]any)
	v := vulns[0].(map[string]any)
	for _, k := range []string{"vulnerabilityID", "severity", "resource", "installedVersion", "fixedVersion", "primaryLink"} {
		if _, ok := v[k]; !ok {
			t.Errorf("%s must be kept", k)
		}
	}
	for _, k := range []string{"title", "description", "links", "cvss", "score", "target", "class", "publishedDate"} {
		if _, ok := v[k]; ok {
			t.Errorf("%s must be dropped", k)
		}
	}
	report := out.(*unstructured.Unstructured).Object["report"].(map[string]any)
	if report["updateTimestamp"] == nil || report["artifact"] == nil {
		t.Error("report-level fields the Vulnerabilities page reads must stay")
	}
}

func TestTrimLeavesOtherReportKindsAlone(t *testing.T) {
	out, _ := trimManagedFields(vulnReport("ConfigAuditReport"))
	v := out.(*unstructured.Unstructured).Object["report"].(map[string]any)["vulnerabilities"].([]any)[0].(map[string]any)
	if v["description"] == nil {
		t.Fatal("only VulnerabilityReports are trimmed")
	}
}
