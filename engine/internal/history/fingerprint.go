package history

import (
	"context"
	"crypto/sha256"
	"encoding/hex"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// Fingerprint names a cluster's history directory. It prefers the
// kube-system namespace UID, so a recreated cluster that reuses a context
// name (kind-kind) starts fresh rather than inheriting old history, and falls
// back to context+server when kube-system isn't readable. Always 16 hex
// characters, so EKS ARNs and other context names never reach the filesystem.
func Fingerprint(ctx context.Context, cs kubernetes.Interface, contextName, server string) string {
	if ns, err := cs.CoreV1().Namespaces().Get(ctx, "kube-system", metav1.GetOptions{}); err == nil && ns.UID != "" {
		return hash("uid:" + string(ns.UID))
	}
	return hash("ctx:" + contextName + "\n" + server)
}

func hash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:16]
}
