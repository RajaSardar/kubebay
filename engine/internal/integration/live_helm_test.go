package integration

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

type helmSummary struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Chart       string `json:"chart"`
	ChartVer    string `json:"chartVersion"`
	Status      string `json:"status"`
	Revision    int    `json:"revision"`
	ApplyMethod string `json:"applyMethod"`
}

// helloChart writes a one-ConfigMap chart whose data comes from the values.
func helloChart(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "kb-hello")
	files := map[string]string{
		"Chart.yaml":               "apiVersion: v2\nname: kb-hello\nversion: 0.1.0\nappVersion: \"1.0\"\n",
		"values.yaml":              "greeting: hello\n",
		"templates/configmap.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}\ndata:\n  greeting: {{ .Values.greeting | quote }}\n",
	}
	for name, body := range files {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func helmClientset(t *testing.T) *kubernetes.Clientset {
	t.Helper()
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
	return cs
}

func helmNamespace(t *testing.T, cs *kubernetes.Clientset, prefix string) string {
	t.Helper()
	ns := fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	if _, err := cs.CoreV1().Namespaces().Create(context.Background(), &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns}}, metav1.CreateOptions{}); err != nil {
		t.Fatalf("namespace: %v", err)
	}
	t.Cleanup(func() { _ = cs.CoreV1().Namespaces().Delete(context.Background(), ns, metav1.DeleteOptions{}) })
	return ns
}

func helmReleases(t *testing.T, base, cluster, ns, name string) []helmSummary {
	t.Helper()
	var all struct {
		Releases []helmSummary `json:"releases"`
	}
	body := httpGetJSON(t, base+"/api/helm/releases?cluster="+url.QueryEscape(cluster))
	if err := json.Unmarshal(body, &all); err != nil {
		t.Fatalf("releases: %v: %s", err, body)
	}
	var out []helmSummary
	for _, r := range all.Releases {
		if r.Namespace == ns && r.Name == name {
			out = append(out, r)
		}
	}
	return out
}

// ADR 0002: the Helm page on the Helm 4 SDK installs, upgrades, rolls back and
// uninstalls through the engine. New installs are server-side applied, and an
// upgrade keeps the method the release was created with.
func TestLiveHelmReleaseLifecycle(t *testing.T) {
	cs := helmClientset(t)
	srv, _ := buildTestServer(t)
	cluster := firstClusterID(t, httpGetJSON(t, srv.URL+"/api/clusters"))
	ns := helmNamespace(t, cs, "kb-helm")
	chart := helloChart(t)
	const name = "kb-hello"
	ctx := context.Background()

	upgrade := func(greeting string, dryRun bool) helmSummary {
		t.Helper()
		code, body := postJSON(t, srv.URL+"/api/helm/upgrade", map[string]any{
			"cluster": cluster, "ns": ns, "name": name, "chartRef": chart,
			"valuesYaml": "greeting: " + greeting, "dryRun": dryRun,
		})
		if code != 200 {
			t.Fatalf("upgrade %q: %d %s", greeting, code, body)
		}
		var s helmSummary
		if err := json.Unmarshal([]byte(body), &s); err != nil {
			t.Fatalf("summary: %v: %s", err, body)
		}
		return s
	}
	greeting := func() string {
		t.Helper()
		cm, err := cs.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			t.Fatalf("configmap: %v", err)
		}
		return cm.Data["greeting"]
	}

	// A dry run renders without touching the cluster.
	if s := upgrade("preview", true); s.Revision != 1 {
		t.Errorf("dry-run summary = %+v, want revision 1", s)
	}
	if _, err := cs.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{}); err == nil {
		t.Fatal("a dry run created the ConfigMap")
	}

	s := upgrade("one", false)
	if s.Revision != 1 || s.Status != "deployed" || s.Chart != "kb-hello" || s.ChartVer != "0.1.0" {
		t.Fatalf("install summary = %+v", s)
	}
	if s.ApplyMethod != "ssa" {
		t.Errorf("install applyMethod = %q, want ssa (Helm 4's default)", s.ApplyMethod)
	}
	if g := greeting(); g != "one" {
		t.Fatalf("after install greeting = %q, want one", g)
	}
	cm, _ := cs.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{})
	applied := false
	for _, mf := range cm.ManagedFields {
		if mf.Operation == metav1.ManagedFieldsOperationApply {
			applied = true
		}
	}
	if !applied {
		t.Errorf("the ConfigMap has no Apply field manager: %+v", cm.ManagedFields)
	}

	// ADR 0004 S7: the release's details list what it created, resolved by
	// the cluster's own discovery.
	var details struct {
		Release   helmSummary `json:"release"`
		Resources []struct {
			APIVersion, Kind, Namespace, Name string
			Namespaced, Served                bool
		} `json:"resources"`
	}
	dq := "?cluster=" + url.QueryEscape(cluster) + "&ns=" + ns + "&name=" + name
	if err := json.Unmarshal(httpGetJSON(t, srv.URL+"/api/helm/release"+dq), &details); err != nil {
		t.Fatal(err)
	}
	if details.Release.Revision != 1 || len(details.Resources) != 1 {
		t.Fatalf("details = %+v", details)
	}
	if r := details.Resources[0]; r.Kind != "ConfigMap" || r.APIVersion != "v1" || r.Namespace != ns || r.Name != name || !r.Namespaced || !r.Served {
		t.Errorf("created = %+v, want the ConfigMap %s/%s", r, ns, name)
	}

	if s := upgrade("two", false); s.Revision != 2 || s.ApplyMethod != "ssa" {
		t.Errorf("upgrade summary = %+v, want revision 2, ssa", s)
	}
	if g := greeting(); g != "two" {
		t.Fatalf("after upgrade greeting = %q, want two", g)
	}

	if code, body := postJSON(t, srv.URL+"/api/helm/rollback", map[string]any{"cluster": cluster, "ns": ns, "name": name, "revision": 1}); code != 200 {
		t.Fatalf("rollback: %d %s", code, body)
	}
	if g := greeting(); g != "one" {
		t.Errorf("after rollback greeting = %q, want one", g)
	}
	q := "?cluster=" + url.QueryEscape(cluster) + "&ns=" + ns + "&name=" + name
	var history []helmSummary
	if err := json.Unmarshal(httpGetJSON(t, srv.URL+"/api/helm/history"+q), &history); err != nil {
		t.Fatal(err)
	}
	if len(history) != 3 {
		t.Errorf("history has %d revisions, want 3: %+v", len(history), history)
	}
	if v := string(httpGetJSON(t, srv.URL+"/api/helm/values"+q)); !strings.Contains(v, "greeting: one") {
		t.Errorf("values = %q, want the rolled-back greeting", v)
	}
	if rels := helmReleases(t, srv.URL, cluster, ns, name); len(rels) != 1 || rels[0].Revision != 3 || rels[0].Status != "deployed" {
		t.Errorf("releases = %+v, want revision 3, deployed", rels)
	}

	if code, body := postJSON(t, srv.URL+"/api/helm/uninstall", map[string]any{"cluster": cluster, "ns": ns, "name": name}); code != 200 {
		t.Fatalf("uninstall: %d %s", code, body)
	}
	if _, err := cs.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{}); err == nil {
		t.Error("the ConfigMap survived the uninstall")
	}
	if rels := helmReleases(t, srv.URL, cluster, ns, name); len(rels) != 0 {
		t.Errorf("releases after uninstall = %+v, want none", rels)
	}
}

// helm3Release is a release as Helm 3 (v3.19) stores it: no apply_method.
const helm3Release = `{"name":"legacy","info":{"first_deployed":"2026-01-02T03:04:05Z","last_deployed":"2026-01-02T03:04:05Z","deleted":"","description":"Install complete","status":"deployed"},"chart":{"metadata":{"name":"kb-hello","version":"0.0.9","appVersion":"0.9","apiVersion":"v2"},"lock":null,"templates":[],"values":{"greeting":"hello"},"schema":null,"files":[]},"config":{"greeting":"from-helm-3"},"manifest":"---\n# Source: kb-hello/templates/configmap.yaml\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: legacy\ndata:\n  greeting: \"from-helm-3\"\n","version":1,"namespace":"%s"}`

// Releases Helm 3 wrote (every release before this change) still list and
// open. They were client-side applied, and the summary says so.
func TestLiveHelmReadsAReleaseHelm3Wrote(t *testing.T) {
	cs := helmClientset(t)
	srv, _ := buildTestServer(t)
	cluster := firstClusterID(t, httpGetJSON(t, srv.URL+"/api/clusters"))
	ns := helmNamespace(t, cs, "kb-helm3")

	// Helm's storage encoding: gzip, then base64, in the Secret's "release" key.
	var gz bytes.Buffer
	w := gzip.NewWriter(&gz)
	if _, err := w.Write([]byte(fmt.Sprintf(helm3Release, ns))); err != nil {
		t.Fatal(err)
	}
	_ = w.Close()
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "sh.helm.release.v1.legacy.v1",
			Namespace: ns,
			Labels:    map[string]string{"name": "legacy", "owner": "helm", "status": "deployed", "version": "1"},
		},
		Type: "helm.sh/release.v1",
		Data: map[string][]byte{"release": []byte(base64.StdEncoding.EncodeToString(gz.Bytes()))},
	}
	if _, err := cs.CoreV1().Secrets(ns).Create(context.Background(), secret, metav1.CreateOptions{}); err != nil {
		t.Fatalf("release secret: %v", err)
	}

	rels := helmReleases(t, srv.URL, cluster, ns, "legacy")
	if len(rels) != 1 {
		t.Fatalf("releases = %+v, want the Helm 3 release", rels)
	}
	if r := rels[0]; r.Status != "deployed" || r.Revision != 1 || r.Chart != "kb-hello" || r.ChartVer != "0.0.9" || r.ApplyMethod != "csa" {
		t.Errorf("Helm 3 release summary = %+v, want deployed, revision 1, kb-hello 0.0.9, csa", r)
	}
	q := "?cluster=" + url.QueryEscape(cluster) + "&ns=" + ns + "&name=legacy"
	if v := string(httpGetJSON(t, srv.URL+"/api/helm/values"+q)); !strings.Contains(v, "from-helm-3") {
		t.Errorf("values = %q", v)
	}
	if m := string(httpGetJSON(t, srv.URL+"/api/helm/manifest"+q)); !strings.Contains(m, "kind: ConfigMap") {
		t.Errorf("manifest = %q", m)
	}
}
