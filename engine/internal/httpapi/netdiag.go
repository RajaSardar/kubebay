package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// DefaultNetDiagImage carries dig, curl, traceroute, nc and friends.
// KUBEBAY_NETDIAG_IMAGE or the request's own image overrides it for
// air-gapped clusters that mirror it elsewhere.
const DefaultNetDiagImage = "nicolaka/netshoot:v0.13"

// netDiagLifetime bounds the pod even if the app dies before deleting it.
const netDiagLifetime = 3600

// NetDiagManager starts short-lived network diagnostic pods (Intelligence
// roadmap Tier 2 #23). The frontend execs into the pod and deletes it when
// the panel closes.
type NetDiagManager struct {
	Clusters *clusters.Manager
	Audit    *audit.Logger
}

type NetDiagRequest struct {
	Cluster   string `json:"cluster"`
	Namespace string `json:"namespace"`
	Node      string `json:"node,omitempty"`
	Image     string `json:"image,omitempty"`
}

func netDiagImage(requested string) string {
	if v := strings.TrimSpace(requested); v != "" {
		return v
	}
	if env := strings.TrimSpace(os.Getenv("KUBEBAY_NETDIAG_IMAGE")); env != "" {
		return env
	}
	return DefaultNetDiagImage
}

// buildNetDiagPod is an ordinary, unprivileged pod on the pod network, in the
// namespace under test so its DNS search path and the NetworkPolicies that
// apply to it match that namespace. It carries only Kubebay's own labels:
// copying a workload's labels could make a Service send real traffic to it.
func buildNetDiagPod(name, ns, node, image string) *corev1.Pod {
	lifetime := int64(netDiagLifetime)
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			Labels:    map[string]string{"app.kubernetes.io/managed-by": "kubebay", "kubebay.io/role": "netdiag"},
		},
		Spec: corev1.PodSpec{
			NodeName:                     node,
			RestartPolicy:                corev1.RestartPolicyNever,
			AutomountServiceAccountToken: priv(false),
			ActiveDeadlineSeconds:        &lifetime,
			Containers: []corev1.Container{
				{
					Name:    "netdiag",
					Image:   image,
					Command: []string{"sleep", fmt.Sprint(netDiagLifetime)},
					SecurityContext: &corev1.SecurityContext{
						AllowPrivilegeEscalation: priv(false),
						SeccompProfile:           &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
					},
				},
			},
		},
	}
}

func (m *NetDiagManager) HandleStart(w http.ResponseWriter, r *http.Request) {
	var req NetDiagRequest
	if err := decodeBody(r, &req); err != nil || req.Cluster == "" || req.Namespace == "" {
		http.Error(w, "cluster and namespace required", http.StatusBadRequest)
		return
	}
	if errs := validation.IsDNS1123Label(req.Namespace); len(errs) > 0 {
		http.Error(w, "invalid namespace: "+strings.Join(errs, "; "), http.StatusBadRequest)
		return
	}
	if req.Node != "" {
		if errs := validation.IsDNS1123Subdomain(req.Node); len(errs) > 0 {
			http.Error(w, "invalid node: "+strings.Join(errs, "; "), http.StatusBadRequest)
			return
		}
	}
	cfg, err := m.Clusters.RestConfigWithIdentity(req.Cluster, clusters.IdentityFromContext(r.Context()))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		http.Error(w, fmt.Sprintf("client: %v", err), http.StatusInternalServerError)
		return
	}

	rb := make([]byte, 4)
	_, _ = rand.Read(rb)
	name := "kubebay-netdiag-" + hex.EncodeToString(rb)
	pods := cs.CoreV1().Pods(req.Namespace)

	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	if _, err := pods.Create(ctx, buildNetDiagPod(name, req.Namespace, req.Node, netDiagImage(req.Image)), metav1.CreateOptions{}); err != nil {
		http.Error(w, fmt.Sprintf("create: %v", err), http.StatusBadGateway)
		return
	}
	// Any failure from here on deletes the pod rather than leaving it behind.
	fail := func(status int, msg string) {
		delCtx, delCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer delCancel()
		_ = pods.Delete(delCtx, name, metav1.DeleteOptions{})
		http.Error(w, msg, status)
	}

	for {
		select {
		case <-ctx.Done():
			fail(http.StatusGatewayTimeout, "timed out waiting for the diagnostic pod (image pull slow?)")
			return
		case <-time.After(1500 * time.Millisecond):
		}
		p, err := pods.Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			continue
		}
		switch p.Status.Phase {
		case corev1.PodRunning:
			m.Audit.Record(audit.Entry{
				Action:    "netdiag-start",
				Cluster:   req.Cluster,
				Namespace: req.Namespace,
				Resource:  name,
				Detail:    "image=" + p.Spec.Containers[0].Image,
				UserAgent: r.Header.Get("User-Agent"),
			})
			writeJSON(w, NodeShellResult{Namespace: req.Namespace, Pod: name})
			return
		case corev1.PodFailed, corev1.PodSucceeded:
			fail(http.StatusBadGateway, "diagnostic pod exited: "+p.Status.Reason+" "+p.Status.Message)
			return
		}
		for _, st := range p.Status.ContainerStatuses {
			if wt := st.State.Waiting; wt != nil {
				switch wt.Reason {
				case "CreateContainerError", "ErrImagePull", "ImagePullBackOff", "InvalidImageName":
					fail(http.StatusBadGateway, wt.Reason+": "+wt.Message)
					return
				}
			}
		}
	}
}
