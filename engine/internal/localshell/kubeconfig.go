//go:build localshell

package localshell

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// writeSessionKubeconfig writes a kubeconfig that carries a current-context and
// nothing else: no clusters, no users, no tokens, no client certificates.
//
// The shell is then given KUBECONFIG=<this file>:<the user's own files>.
// client-go merges in precedence order and the first file that sets
// current-context wins, so the shell opens on the context the user picked in
// the UI while every credential stays in the file that already held it.
//
// Copying the user's config — or minifying it — would write inline `token:` and
// `client-key-data:` verbatim into a second file on disk, and a config written
// into a new directory silently re-resolves relative certificate-authority
// paths against that directory.  Neither is worth it for a current-context.
//
// A side benefit: `kubectl config use-context` inside the shell rewrites this
// throwaway file, which is first on the list, instead of the user's real one.
func writeSessionKubeconfig(dir, contextName string) (string, error) {
	cfg := clientcmdapi.NewConfig()
	cfg.CurrentContext = contextName
	b, err := clientcmd.Write(*cfg)
	if err != nil {
		return "", fmt.Errorf("render kubeconfig: %w", err)
	}
	path := filepath.Join(dir, "kubeconfig")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", fmt.Errorf("create kubeconfig: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(b); err != nil {
		return "", fmt.Errorf("write kubeconfig: %w", err)
	}
	return path, nil
}

func kubeconfigEnv(sessionPath string, userPaths []string) string {
	out := []string{sessionPath}
	for _, p := range userPaths {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, string(os.PathListSeparator))
}
