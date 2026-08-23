package integration

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func restConfigOrSkip(t *testing.T) (*kubernetes.Clientset, error) {
	t.Helper()
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		return nil, err
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	return cs, nil
}

func waitForBatch(t *testing.T, sub *informers.Subscription, timeout time.Duration, match func([]stream.Op) bool) []stream.Op {
	t.Helper()
	timer := time.After(timeout)
	for {
		select {
		case batch := <-sub.Deltas():
			if match(batch) {
				return batch
			}
		case <-timer:
			t.Fatalf("timed out after %v waiting for matching delta batch", timeout)
		}
	}
}

func TestLiveDeltaStream(t *testing.T) {
	if os.Getenv("KUBEBAY_INTEGRATION_TEST") != "1" {
		t.Skip("set KUBEBAY_INTEGRATION_TEST=1 against a reachable API server")
	}
	cs, err := restConfigOrSkip(t)
	if err != nil {
		t.Skipf("no usable kubeconfig: %v", err)
	}

	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		clientcmd.NewDefaultClientConfigLoadingRules(), &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		t.Fatalf("rest config: %v", err)
	}
	pool, err := informers.New(cfg)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub, err := pool.Subscribe(ctx, "v1/configmaps", nil, "", "metadata")
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	select {
	case snap := <-sub.Snapshot():
		t.Logf("snapshot received: %d configmaps in indexer", len(snap))
	case <-time.After(90 * time.Second):
		t.Fatal("timeout waiting for initial snapshot")
	}

	name := fmt.Sprintf("kubebay-it-%d", time.Now().UnixNano())
	key := "default/" + name

	cm := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default"}}
	createCtx, createCancel := context.WithTimeout(ctx, 15*time.Second)
	_, err = cs.CoreV1().ConfigMaps("default").Create(createCtx, cm, metav1.CreateOptions{})
	createCancel()
	if err != nil {
		t.Fatalf("create configmap: %v", err)
	}

	waitForBatch(t, sub, 30*time.Second, func(batch []stream.Op) bool {
		for _, op := range batch {
			if op.Key == key && (op.Op == stream.OpAdd || op.Op == stream.OpModify) {
				t.Logf("live ADD/MODIFY observed for %s via coalesced stream", key)
				return true
			}
		}
		return false
	})

	deleteCtx, deleteCancel := context.WithTimeout(ctx, 15*time.Second)
	err = cs.CoreV1().ConfigMaps("default").Delete(deleteCtx, name, metav1.DeleteOptions{})
	deleteCancel()
	if err != nil {
		t.Fatalf("delete configmap: %v", err)
	}

	waitForBatch(t, sub, 30*time.Second, func(batch []stream.Op) bool {
		for _, op := range batch {
			if op.Key == key && op.Op == stream.OpDelete {
				t.Logf("live DELETE observed for %s — full round-trip proven", key)
				return true
			}
		}
		return false
	})

	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
	_ = cs.CoreV1().ConfigMaps("default").Delete(cleanupCtx, name, metav1.DeleteOptions{})
	cleanupCancel()
	_ = apierrors.IsNotFound(nil)
	cancel()
}
