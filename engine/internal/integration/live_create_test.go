package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

func postJSON(t *testing.T, u string, body any) (int, string) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, u, bytes.NewReader(b))
	req.Header.Set("X-Kubebay-Token", "testtoken")
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post %s: %v", u, err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(out)
}

// Create used to force-apply, silently taking over fields Helm or kubectl own
// when the object already existed. It must now leave them alone and explain.
func TestLiveCreateOverAnObjectAnotherToolManages(t *testing.T) {
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
	name := fmt.Sprintf("kb-create-%d", time.Now().UnixNano())
	np := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default"},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"app": "helm-owned"}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
		},
	}
	if _, err := cs.NetworkingV1().NetworkPolicies("default").Create(ctx, np, metav1.CreateOptions{FieldManager: "helm"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		_ = cs.NetworkingV1().NetworkPolicies("default").Delete(context.Background(), name, metav1.DeleteOptions{})
	})

	doc := fmt.Sprintf(`apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: %s
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: kubebay-wants-this
  policyTypes: ["Ingress"]
`, name)
	code, body := postJSON(t, srv.URL+"/api/yaml/create", map[string]any{"cluster": clusterID, "yaml": doc, "dryRun": false})
	if code != http.StatusConflict {
		t.Fatalf("create over helm-owned policy: got %d %s, want 409", code, body)
	}
	if !strings.Contains(body, "already exists") || !strings.Contains(body, "YAML tab") {
		t.Errorf("409 body should explain what to do: %s", body)
	}
	got, err := cs.NetworkingV1().NetworkPolicies("default").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if got.Spec.PodSelector.MatchLabels["app"] != "helm-owned" {
		t.Errorf("helm's selector was overwritten: %v", got.Spec.PodSelector.MatchLabels)
	}

	// A brand-new object still creates.
	fresh := strings.ReplaceAll(doc, name, name+"-new")
	t.Cleanup(func() {
		_ = cs.NetworkingV1().NetworkPolicies("default").Delete(context.Background(), name+"-new", metav1.DeleteOptions{})
	})
	if code, body := postJSON(t, srv.URL+"/api/yaml/create", map[string]any{"cluster": clusterID, "yaml": fresh, "dryRun": false}); code != http.StatusOK {
		t.Fatalf("create of a new policy: %d %s", code, body)
	}
}
