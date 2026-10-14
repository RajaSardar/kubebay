package integration

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	resourcev1 "k8s.io/api/resource/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/utils/ptr"

	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// KB-12: Dynamic Resource Allocation objects (resource.k8s.io/v1, GA in
// Kubernetes 1.34) stream like any other kind, cluster-scoped ResourceSlices
// and DeviceClasses as well as namespaced ResourceClaims. Skipped on clusters
// that don't serve the GA API.
func TestLiveDRAObjectsStream(t *testing.T) {
	if os.Getenv("KUBEBAY_INTEGRATION_TEST") != "1" {
		t.Skip("set KUBEBAY_INTEGRATION_TEST=1 against a reachable API server")
	}
	cs, err := restConfigOrSkip(t)
	if err != nil {
		t.Skipf("no usable kubeconfig: %v", err)
	}
	if _, err := cs.Discovery().ServerResourcesForGroupVersion("resource.k8s.io/v1"); err != nil {
		if apierrors.IsNotFound(err) {
			t.Skip("resource.k8s.io/v1 isn't served here (Kubernetes before 1.34)")
		}
		t.Fatalf("discovery: %v", err)
	}
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(safeKubeconfigRules(t), &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		t.Fatalf("rest config: %v", err)
	}
	pool, err := informers.New(cfg)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	subscribe := func(gvr string) *informers.Subscription {
		sub, err := pool.Subscribe(ctx, gvr, nil, "", "full")
		if err != nil {
			t.Fatalf("subscribe %s: %v", gvr, err)
		}
		select {
		case <-sub.Snapshot():
		case <-time.After(90 * time.Second):
			t.Fatalf("no snapshot for %s", gvr)
		}
		return sub
	}
	slices := subscribe("resource.k8s.io/v1/resourceslices")
	classes := subscribe("resource.k8s.io/v1/deviceclasses")
	claims := subscribe("resource.k8s.io/v1/resourceclaims")

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	driver := "gpu.kubebay.test"
	class := &resourcev1.DeviceClass{
		ObjectMeta: metav1.ObjectMeta{Name: "kubebay-it-gpu-" + suffix},
		Spec: resourcev1.DeviceClassSpec{Selectors: []resourcev1.DeviceSelector{{
			CEL: &resourcev1.CELDeviceSelector{Expression: fmt.Sprintf("device.driver == %q", driver)},
		}}},
	}
	slice := &resourcev1.ResourceSlice{
		ObjectMeta: metav1.ObjectMeta{Name: "kubebay-it-slice-" + suffix},
		Spec: resourcev1.ResourceSliceSpec{
			Driver:   driver,
			Pool:     resourcev1.ResourcePool{Name: "pool-" + suffix, ResourceSliceCount: 1},
			AllNodes: ptr.To(true),
			Devices:  []resourcev1.Device{{Name: "gpu-0"}, {Name: "gpu-1"}},
		},
	}
	claim := &resourcev1.ResourceClaim{
		ObjectMeta: metav1.ObjectMeta{Name: "kubebay-it-claim-" + suffix, Namespace: "default"},
		Spec: resourcev1.ResourceClaimSpec{Devices: resourcev1.DeviceClaim{Requests: []resourcev1.DeviceRequest{{
			Name:    "gpu",
			Exactly: &resourcev1.ExactDeviceRequest{DeviceClassName: class.Name},
		}}}},
	}

	api := cs.ResourceV1()
	if _, err := api.DeviceClasses().Create(ctx, class, metav1.CreateOptions{}); err != nil {
		t.Fatalf("create DeviceClass: %v", err)
	}
	defer func() { _ = api.DeviceClasses().Delete(context.Background(), class.Name, metav1.DeleteOptions{}) }()
	if _, err := api.ResourceSlices().Create(ctx, slice, metav1.CreateOptions{}); err != nil {
		t.Fatalf("create ResourceSlice: %v", err)
	}
	defer func() { _ = api.ResourceSlices().Delete(context.Background(), slice.Name, metav1.DeleteOptions{}) }()
	if _, err := api.ResourceClaims("default").Create(ctx, claim, metav1.CreateOptions{}); err != nil {
		t.Fatalf("create ResourceClaim: %v", err)
	}
	defer func() { _ = api.ResourceClaims("default").Delete(context.Background(), claim.Name, metav1.DeleteOptions{}) }()

	added := func(key string) func([]stream.Op) bool {
		return func(batch []stream.Op) bool {
			for _, op := range batch {
				if op.Key == key && (op.Op == stream.OpAdd || op.Op == stream.OpModify) {
					return true
				}
			}
			return false
		}
	}
	waitForBatch(t, classes, 30*time.Second, added(class.Name))
	waitForBatch(t, slices, 30*time.Second, added(slice.Name))
	waitForBatch(t, claims, 30*time.Second, added("default/"+claim.Name))
}
