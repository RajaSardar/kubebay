package httpapi

// debugcontainer.go — "Debug with ephemeral container" for the pod Terminal tab.
//
// The engine adds an ephemeral container to a running pod through the pod's
// ephemeralcontainers subresource (the same call `kubectl debug` makes). The
// client then opens the usual exec terminal against the new container, so the
// shell itself needs no new transport. The call goes through the caller's
// impersonated identity like every other action, and the route audits it.

import (
	"context"
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
)

// DefaultDebugImage is the debug image offered until Settings names another.
const DefaultDebugImage = "busybox:1.36"

// validDebugImage refuses an empty image or one holding whitespace or shell
// metacharacters. The image goes into a pod spec, not a shell, so this is a
// typo guard rather than a security boundary; the API server validates the rest.
func validDebugImage(image string) bool {
	if image == "" {
		return false
	}
	return !strings.ContainsAny(image, " \t\r\n;&|$`'\"\\<>(){}")
}

// buildEphemeralContainerPatch returns a fresh container name and the
// strategic-merge patch that appends one interactive ephemeral container to a
// pod. existing holds the pod's current ephemeral container names so the new
// name never collides (ephemeral containers can't be removed or reused).
func buildEphemeralContainerPatch(existing []string, image, target string) (string, []byte, error) {
	image = strings.TrimSpace(image)
	if !validDebugImage(image) {
		return "", nil, fmt.Errorf("invalid debug image %q", image)
	}
	taken := map[string]bool{}
	for _, n := range existing {
		taken[n] = true
	}
	name := ""
	for i := 0; i < 20; i++ {
		b := make([]byte, 3)
		if _, err := crand.Read(b); err != nil {
			return "", nil, err
		}
		cand := "debugger-" + hex.EncodeToString(b)[:5]
		if !taken[cand] {
			name = cand
			break
		}
	}
	if name == "" {
		return "", nil, fmt.Errorf("could not pick a free container name")
	}
	c := map[string]any{
		"name":                     name,
		"image":                    image,
		"stdin":                    true,
		"tty":                      true,
		"terminationMessagePolicy": "File",
	}
	if target = strings.TrimSpace(target); target != "" {
		c["targetContainerName"] = target
	}
	data, err := json.Marshal(map[string]any{"spec": map[string]any{"ephemeralContainers": []any{c}}})
	return name, data, err
}

func debugContainerAuditDetail(container, image, target string) string {
	d := fmt.Sprintf("container=%s image=%s", container, image)
	if target != "" {
		d += " target=" + target
	}
	return d
}

// AddEphemeralContainer attaches a debug container to a pod and returns its name.
func (a *Actions) AddEphemeralContainer(ctx context.Context, cluster, ns, podName, image, target string) (string, error) {
	d, err := a.dyn(ctx, cluster)
	if err != nil {
		return "", err
	}
	g, err := mustGVR("v1/pods")
	if err != nil {
		return "", err
	}
	obj, err := d.Resource(g).Namespace(ns).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	var pod corev1.Pod
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(obj.Object, &pod); err != nil {
		return "", err
	}
	if pod.Status.Phase != corev1.PodRunning {
		return "", fmt.Errorf("pod %s/%s is %s: a debug container needs a Running pod", ns, podName, strings.ToLower(string(pod.Status.Phase)))
	}
	existing := make([]string, 0, len(pod.Spec.EphemeralContainers))
	for _, ec := range pod.Spec.EphemeralContainers {
		existing = append(existing, ec.Name)
	}
	name, patch, err := buildEphemeralContainerPatch(existing, image, target)
	if err != nil {
		return "", err
	}
	if _, err := d.Resource(g).Namespace(ns).Patch(ctx, podName, types.StrategicMergePatchType, patch, metav1.PatchOptions{FieldManager: "kubebay"}, "ephemeralcontainers"); err != nil {
		return "", err
	}
	waitEphemeralRunning(ctx, func() (*corev1.Pod, error) {
		o, err := d.Resource(g).Namespace(ns).Get(ctx, podName, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		var p corev1.Pod
		return &p, runtime.DefaultUnstructuredConverter.FromUnstructured(o.Object, &p)
	}, name)
	return name, nil
}

// waitEphemeralRunning gives the new container a few seconds to start so the
// terminal that opens next finds it running. It never fails the request: if
// the container is slow (a large image pull), exec's own preflight says so.
func waitEphemeralRunning(ctx context.Context, get func() (*corev1.Pod, error), name string) {
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if p, err := get(); err == nil {
			for _, st := range p.Status.EphemeralContainerStatuses {
				if st.Name == name && (st.State.Running != nil || st.State.Terminated != nil) {
					return
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}
