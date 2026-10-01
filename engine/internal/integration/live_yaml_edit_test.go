package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

func putJSON(t *testing.T, u string, body any) (int, string) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPut, u, bytes.NewReader(b))
	req.Header.Set("X-Kubebay-Token", "testtoken")
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("put %s: %v", u, err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(out)
}

// Regression for the user-reported "Apply failed with 3 conflicts: conflicts
// with "kubectl-client-side-apply"" when editing a Deployment's env values
// in the YAML tab.
func TestLiveYAMLEditOfKubectlManagedDeployment(t *testing.T) {
	if os.Getenv("KUBEBAY_INTEGRATION_TEST") != "1" {
		t.Skip("set KUBEBAY_INTEGRATION_TEST=1 against a reachable API server")
	}
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(safeKubeconfigRules(t), &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		t.Skipf("no kubeconfig: %v", err)
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		t.Fatalf("clientset: %v", err)
	}
	srv, _ := buildTestServer(t)
	clusterID := firstClusterID(t, httpGetJSON(t, srv.URL+"/api/clusters"))

	ctx := context.Background()
	name := fmt.Sprintf("kb-edit-%d", time.Now().UnixNano())
	zero := int32(0)
	labels := map[string]string{"app": name}
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "default",
			Annotations: map[string]string{"kubectl.kubernetes.io/last-applied-configuration": `{"kind":"Deployment"}`},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &zero,
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{Containers: []corev1.Container{{
					Name: "debugging-apis", Image: "registry.k8s.io/pause:3.9",
					Env: []corev1.EnvVar{{Name: "CONFIG_USER", Value: "old-user"}, {Name: "REGION", Value: "eu-west-1"}, {Name: "KEEP", Value: "same"}},
				}}},
			},
		},
	}
	// The same field manager and operation `kubectl apply` (client-side) uses.
	if _, err := cs.AppsV1().Deployments("default").Create(ctx, dep, metav1.CreateOptions{FieldManager: "kubectl-client-side-apply"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		_ = cs.AppsV1().Deployments("default").Delete(context.Background(), name, metav1.DeleteOptions{})
	})

	q := url.Values{"cluster": {clusterID}, "gvr": {"apps/v1/deployments"}, "ns": {"default"}, "name": {name}}
	original := string(httpGetJSON(t, srv.URL+"/api/yaml?"+q.Encode()))
	edited := strings.Replace(strings.Replace(original, "old-user", "new-user", 1), "eu-west-1", "us-east-1", 1)
	base := map[string]any{"cluster": clusterID, "gvr": "apps/v1/deployments", "ns": "default", "name": name, "yaml": edited, "dryRun": false, "force": false}

	// The old whole-object server-side apply reproduces the reported conflict.
	if code, body := putJSON(t, srv.URL+"/api/yaml", base); code == http.StatusOK || !strings.Contains(strings.ToLower(body), "conflict") {
		t.Fatalf("expected the legacy apply to conflict with kubectl-client-side-apply, got %d %s", code, body)
	}

	withOriginal := map[string]any{}
	for k, v := range base {
		withOriginal[k] = v
	}
	withOriginal["original"] = original
	if code, body := putJSON(t, srv.URL+"/api/yaml", withOriginal); code != http.StatusOK {
		t.Fatalf("edit failed: %d %s", code, body)
	}
	got, err := cs.AppsV1().Deployments("default").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	env := map[string]string{}
	for _, e := range got.Spec.Template.Spec.Containers[0].Env {
		env[e.Name] = e.Value
	}
	if env["CONFIG_USER"] != "new-user" || env["REGION"] != "us-east-1" || env["KEEP"] != "same" {
		t.Errorf("env after edit = %v", env)
	}
	var kubebay *metav1.ManagedFieldsEntry
	for i, m := range got.ManagedFields {
		if m.Manager == "kubebay" {
			kubebay = &got.ManagedFields[i]
		}
	}
	if kubebay == nil || kubebay.Operation != metav1.ManagedFieldsOperationUpdate {
		t.Fatalf("want a kubebay Update entry, got %+v", got.ManagedFields)
	}
	owned := string(kubebay.FieldsV1.Raw)
	if strings.Contains(owned, `"f:image"`) || strings.Contains(owned, `"f:replicas"`) {
		t.Errorf("kubebay took ownership of fields it didn't change: %s", owned)
	}

	// Removing an env var removes it (the old apply path silently kept it).
	original2 := string(httpGetJSON(t, srv.URL+"/api/yaml?"+q.Encode()))
	lines := strings.Split(original2, "\n")
	var kept []string
	for i := 0; i < len(lines); i++ {
		if strings.Contains(lines[i], "name: KEEP") {
			i++ // drop "- name: KEEP" and its "value: same" line
			continue
		}
		kept = append(kept, lines[i])
	}
	withOriginal["original"] = original2
	withOriginal["yaml"] = strings.Join(kept, "\n")
	if code, body := putJSON(t, srv.URL+"/api/yaml", withOriginal); code != http.StatusOK {
		t.Fatalf("remove env failed: %d %s", code, body)
	}
	got, _ = cs.AppsV1().Deployments("default").Get(ctx, name, metav1.GetOptions{})
	for _, e := range got.Spec.Template.Spec.Containers[0].Env {
		if e.Name == "KEEP" {
			t.Errorf("KEEP should have been removed: %v", got.Spec.Template.Spec.Containers[0].Env)
		}
	}
}
