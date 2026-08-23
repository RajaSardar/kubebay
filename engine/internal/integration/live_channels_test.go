package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func buildTestServer(t *testing.T) (*httptest.Server, *clusters.Manager) {
	t.Helper()
	kc := os.Getenv("KUBECONFIG")
	log := testLogger(t)
	mgr, err := clusters.NewManager(log, kc)
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	registry := informers.NewPoolRegistry(mgr)
	channels := httpapi.NewChannels(mgr)
	hub := stream.NewHub(log, channels)
	auth, err := httpapi.NewAuthenticator("", "", "", "")
	if err != nil {
		t.Fatalf("auth: %v", err)
	}
	handler := httpapi.Router(httpapi.Deps{
		Log:       log,
		Clusters:  mgr,
		Pools:     registry,
		Hub:       hub,
		Channels:  channels,
		PF:        httpapi.NewPFManager(mgr),
		Actions:   &httpapi.Actions{Clusters: mgr},
		Metrics:   &httpapi.Metrics{Clusters: mgr},
		RBAC:      &httpapi.RBAC{Clusters: mgr},
		Helm:      httpapi.NewHelm(mgr),
		NodeShell: &httpapi.NodeShellManager{Clusters: mgr},
		Auth:      auth,
	}, "testtoken")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv, mgr
}

func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?token=testtoken"
	c, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	t.Cleanup(func() { _ = c.Close(websocket.StatusNormalClosure, "") })
	return c
}

func sendText(t *testing.T, c *websocket.Conn, payload string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, []byte(payload)); err != nil {
		t.Fatalf("ws write: %v", err)
	}
}

// readUntil collects binary chan-data for chanID until match(dataBytes) or timeout.
func readUntil(
	t *testing.T,
	c *websocket.Conn,
	chanID string,
	timeout time.Duration,
	match func([]byte) bool,
) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	var buf []byte
	for time.Now().Before(deadline) {
		msgType, data, err := c.Read(ctx)
		if err != nil {
			return false
		}
		if msgType != websocket.MessageBinary {
			continue
		}
		frame, err := stream.DecodeData(data)
		if err != nil || frame.Type != stream.TypeChanData || frame.ID != chanID {
			continue
		}
		buf = append(buf, frame.Data...)
		if match(buf) {
			return true
		}
	}
	return false
}

// readClosed waits for chan-closed control and returns its message.
func readClosed(t *testing.T, c *websocket.Conn, chanID string, timeout time.Duration) string {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithDeadline(context.Background(), deadline)
		msgType, data, err := c.Read(ctx)
		cancel()
		if err != nil {
			return ""
		}
		if msgType != websocket.MessageText {
			continue
		}
		var f stream.ControlFrame
		if err := jsonUnmarshal(data, &f); err != nil {
			continue
		}
		if f.Type == stream.TypeChanClosed && f.ID == chanID {
			return f.Message
		}
	}
	return ""
}

func waitForPodRunning(t *testing.T, cs *kubernetes.Clientset, ns, name string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		p, err := cs.CoreV1().Pods(ns).Get(context.Background(), name, metav1.GetOptions{})
		if err == nil && p.Status.Phase == corev1.PodRunning && len(p.Status.ContainerStatuses) > 0 &&
			p.Status.ContainerStatuses[0].State.Running != nil {
			time.Sleep(1500 * time.Millisecond)
			return
		}
		time.Sleep(time.Second)
	}
	t.Fatalf("pod %s/%s never became running", ns, name)
}

func TestLiveChannelsHTTP(t *testing.T) {
	if os.Getenv("KUBEBAY_INTEGRATION_TEST") != "1" {
		t.Skip("set KUBEBAY_INTEGRATION_TEST=1 against a reachable API server")
	}
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		t.Skipf("no kubeconfig: %v", err)
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		t.Fatalf("clientset: %v", err)
	}

	srv, _ := buildTestServer(t)
	c := dialWS(t, srv)

	clusterID := ""
	mgrCfg := cfg.Host
	_ = mgrCfg
	// resolve cluster id from manager list via REST
	listBody := httpGetJSON(t, srv.URL+"/api/clusters?token=testtoken")
	clusterID = firstClusterID(t, listBody)

	testName := fmt.Sprintf("kb-exec-test-%d", time.Now().UnixNano())
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: testName, Namespace: "default", Labels: map[string]string{"kubebay.io/test": "exec"}},
		Spec: corev1.PodSpec{
			RestartPolicy: corev1.RestartPolicyNever,
			Tolerations:   []corev1.Toleration{{Operator: corev1.TolerationOpExists}},
			Containers: []corev1.Container{
				{Name: "main", Image: "registry.k8s.io/e2e-test-images/busybox:1.29-2", Command: []string{"sleep", "180"}},
			},
		},
	}
	ctx := context.Background()
	_, err = cs.CoreV1().Pods("default").Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		t.Fatalf("create exec-test pod: %v", err)
	}
	defer func() {
		_ = cs.CoreV1().Pods("default").Delete(context.Background(), testName, metav1.DeleteOptions{})
	}()
	waitForPodRunning(t, cs, "default", testName, 120*time.Second)

	openExec := func(id string, cmd []string, ns, target string) {
		sendText(t, c, fmt.Sprintf(
			`{"type":"chan-open","id":%q,"kind":"exec","cluster":%q,"namespace":%q,"pod":%q,"container":"","command":["%s"]}`,
			id, clusterID, ns, target, strings.Join(cmd, `","`),
		))
	}

	t.Run("ExecEcho", func(t *testing.T) {
		id := "exec-echo"
		openExec(id, []string{"sh", "-c", "echo KBTEST_$((41+1))_OK"}, "default", testName)
		ok := readUntil(t, c, id, 30*time.Second, func(b []byte) bool {
			return bytes.Contains(b, []byte("KBTEST_42_OK"))
		})
		if !ok {
			t.Fatal("did not observe KBTEST_42_OK from exec channel")
		}
		sendText(t, c, fmt.Sprintf(`{"type":"chan-close","id":%q}`, id))
	})

	t.Run("LogsChannel", func(t *testing.T) {
		execName := testName + "-logger"
		loggerPod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: execName, Namespace: "default"},
			Spec: corev1.PodSpec{
				RestartPolicy: corev1.RestartPolicyNever,
				Tolerations:   []corev1.Toleration{{Operator: corev1.TolerationOpExists}},
				Containers: []corev1.Container{
					{Name: "main", Image: "registry.k8s.io/e2e-test-images/busybox:1.29-2",
						Command: []string{"sh", "-c", "echo LOGLINE_MARKER; sleep 60"}},
				},
			},
		}
		_, err := cs.CoreV1().Pods("default").Create(ctx, loggerPod, metav1.CreateOptions{})
		if err != nil {
			t.Fatalf("create logger pod: %v", err)
		}
		defer func() { _ = cs.CoreV1().Pods("default").Delete(context.Background(), execName, metav1.DeleteOptions{}) }()
		waitForPodRunning(t, cs, "default", execName, 120*time.Second)

		id := "logs-1"
		sendText(t, c, fmt.Sprintf(
			`{"type":"chan-open","id":%q,"kind":"logs","cluster":%q,"namespace":"default","pod":%q,"tail":50,"follow":false}`,
			id, clusterID, execName,
		))
		ok := readUntil(t, c, id, 30*time.Second, func(b []byte) bool {
			return bytes.Contains(b, []byte("LOGLINE_MARKER"))
		})
		if !ok {
			t.Fatal("did not observe LOGLINE_MARKER via logs channel")
		}
	})

	t.Run("ExecDistrolessCleanError", func(t *testing.T) {
		dnsPods, err := cs.CoreV1().Pods("kube-system").List(ctx, metav1.ListOptions{LabelSelector: "k8s-app=kube-dns"})
		if err != nil || len(dnsPods.Items) == 0 {
			t.Skip("no coredns pod to probe")
		}
		id := "exec-distroless"
		openExec(id, []string{"sh"}, "kube-system", dnsPods.Items[0].Name)
		msg := readClosed(t, c, id, 30*time.Second)
		lower := strings.ToLower(msg)
		if msg == "" || (!strings.Contains(lower, "not found") && !strings.Contains(lower, "not running") && !strings.Contains(lower, "unavailable")) {
			t.Fatalf("expected clean actionable error for distroless exec, got %q", msg)
		}
		t.Logf("distroless exec produced clean error: %q", msg)
	})
}

func testLogger(t *testing.T) *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func jsonUnmarshal(b []byte, v any) error {
	return json.Unmarshal(b, v)
}

func httpGetJSON(t *testing.T, url string) []byte {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("get %s: %v", url, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return body
}

func firstClusterID(t *testing.T, body []byte) string {
	var list []struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		t.Fatalf("parse clusters: %v", err)
	}
	for _, c := range list {
		if c.Status == "connected" {
			return c.ID
		}
	}
	for _, c := range list {
		return c.ID
	}
	t.Fatal("no clusters")
	return ""
}
