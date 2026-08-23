package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

type NodeShellManager struct {
	Clusters *clusters.Manager
}

type NodeShellRequest struct {
	Cluster string `json:"cluster"`
	Node    string `json:"node"`
}

type NodeShellResult struct {
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
}

func priv(b bool) *bool { return &b }

func (n *NodeShellManager) HandleStart(w http.ResponseWriter, r *http.Request) {
	var req NodeShellRequest
	if err := decodeBody(r, &req); err != nil || req.Cluster == "" || req.Node == "" {
		http.Error(w, "cluster and node required", http.StatusBadRequest)
		return
	}
	cfg, err := n.Clusters.RestConfigWithIdentity(req.Cluster, clusters.IdentityFromContext(r.Context()))
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
	name := "kubebay-node-shell-" + hex.EncodeToString(rb)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "default",
			Labels:    map[string]string{"app.kubernetes.io/managed-by": "kubebay", "kubebay.io/role": "node-shell"},
		},
		Spec: corev1.PodSpec{
			NodeName:      req.Node,
			HostPID:       true,
			RestartPolicy: corev1.RestartPolicyNever,
			Tolerations:   []corev1.Toleration{{Operator: corev1.TolerationOpExists}},
			Containers: []corev1.Container{
				{
					Name:            "shell",
					Image:           "registry.k8s.io/e2e-test-images/busybox:1.29-2",
					Command:         []string{"sh"},
					Stdin:           true,
					StdinOnce:       true,
					TTY:             true,
					SecurityContext: &corev1.SecurityContext{Privileged: priv(true)},
				},
			},
		},
	}

	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	created, err := cs.CoreV1().Pods("default").Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("create: %v", err), http.StatusBadGateway)
		return
	}

	for {
		select {
		case <-ctx.Done():
			http.Error(w, "timed out waiting for node shell pod (image pull slow?)", http.StatusGatewayTimeout)
			return
		case <-time.After(1500 * time.Millisecond):
		}
		p, err := cs.CoreV1().Pods("default").Get(ctx, created.Name, metav1.GetOptions{})
		if err != nil && !apierrors.IsNotFound(err) {
			continue
		}
		if p != nil && p.Status.Phase == corev1.PodRunning {
			writeJSON(w, NodeShellResult{Namespace: "default", Pod: p.Name})
			return
		}
		if p != nil {
			for _, st := range p.Status.ContainerStatuses {
				if st.State.Waiting != nil && st.State.Waiting.Reason == "CreateContainerError" {
					http.Error(w, "container error: "+st.State.Waiting.Message, http.StatusBadGateway)
					return
				}
			}
		}
	}
}
