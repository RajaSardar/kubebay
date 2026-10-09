package clusters

import (
	"fmt"
	"strings"

	"k8s.io/client-go/rest"
)

const (
	execV1alpha1 = "client.authentication.k8s.io/v1alpha1"
	execV1beta1  = "client.authentication.k8s.io/v1beta1"
)

// UpgradeLegacyExec asks an exec credential plugin configured for
// client.authentication.k8s.io/v1alpha1, which client-go dropped in v1.24, for
// v1beta1 instead. Kubeconfigs written by an old `aws eks update-kubeconfig`
// still say v1alpha1 long after the CLI on PATH learned v1beta1; current
// plugins read the version they are asked for from KUBERNETES_EXEC_INFO and
// answer in it. Only the in-memory config changes, never the user's file. A
// plugin too old to answer v1beta1 still fails, and explainExecError names it.
// Reports whether it changed anything.
func UpgradeLegacyExec(cfg *rest.Config) bool {
	if cfg == nil || cfg.ExecProvider == nil || cfg.ExecProvider.APIVersion != execV1alpha1 {
		return false
	}
	// The exec stanza is shared with the loaded kubeconfig; change a copy.
	exec := *cfg.ExecProvider
	exec.APIVersion = execV1beta1
	cfg.ExecProvider = &exec
	return true
}

// explainExecError replaces client-go's error for a plugin that still answers
// v1alpha1 ("decoding stdout: no kind "ExecCredential" is registered for
// version v1alpha1"), which reads like a client-go bug, with what happened and
// how to fix it.
func explainExecError(cfg *rest.Config, legacy bool, msg string) string {
	if !legacy || cfg == nil || cfg.ExecProvider == nil || !strings.Contains(msg, execV1alpha1) {
		return msg
	}
	return fmt.Sprintf("this kubeconfig asks for %s, which client-go no longer accepts, and its exec plugin %q only answers in that version: "+
		"update the plugin (for EKS, a current AWS CLI), then re-run the command that wrote the kubeconfig (for EKS, aws eks update-kubeconfig) so it asks for %s",
		execV1alpha1, cfg.ExecProvider.Command, execV1beta1)
}
