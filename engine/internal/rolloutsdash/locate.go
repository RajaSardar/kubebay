// Package rolloutsdash runs the upstream `kubectl-argo-rollouts dashboard` for
// one cluster on the desktop, so the Rollouts page can show it in a frame
// (backlog 87). The plugin is only ever located, never downloaded; it runs
// with the user's own kubeconfig on loopback, behind a same-origin proxy that
// needs a per-run path token (see httpapi/rolloutsdash.go).
package rolloutsdash

import (
	"os"
	"path/filepath"
	"runtime"
)

// PluginName is the executable kubectl dispatches `kubectl argo rollouts` to.
// Finding it is the same as finding the kubectl plugin: kubectl only forwards
// to this file, so there is nothing to ask kubectl for.
const PluginName = "kubectl-argo-rollouts"

func exeName() string {
	if runtime.GOOS == "windows" {
		return PluginName + ".exe"
	}
	return PluginName
}

// CommonPaths are where the plugin lands when a desktop app's short PATH
// misses it: Homebrew (both prefixes), a manual install, krew and go install.
func CommonPaths(home string) []string {
	n := exeName()
	out := []string{
		filepath.Join("/opt/homebrew/bin", n),
		filepath.Join("/usr/local/bin", n),
	}
	if home != "" {
		out = append(out,
			filepath.Join(home, ".krew", "bin", n),
			filepath.Join(home, "go", "bin", n),
		)
	}
	return out
}

func isExecFile(p string) bool {
	st, err := os.Stat(p)
	if err != nil || !st.Mode().IsRegular() {
		return false
	}
	return runtime.GOOS == "windows" || st.Mode().Perm()&0o111 != 0
}

// Find returns the absolute path of the plugin: PATH first, then the
// candidates. Empty when it is not installed. Relative PATH entries are
// ignored (they would run whatever sits in the current directory).
func Find(pathEnv string, candidates []string) string {
	for _, dir := range filepath.SplitList(pathEnv) {
		if dir == "" || !filepath.IsAbs(dir) {
			continue
		}
		if p := filepath.Join(dir, exeName()); isExecFile(p) {
			return p
		}
	}
	for _, p := range candidates {
		if filepath.IsAbs(p) && isExecFile(p) {
			return p
		}
	}
	return ""
}

// Help is what the UI shows when the plugin is missing. Text only: Kubebay
// downloads and installs nothing.
type Help struct {
	Commands    []string `json:"commands"`
	ReleasesURL string   `json:"releasesUrl"`
}

func InstallHelp() Help {
	return Help{
		Commands: []string{
			"brew install argoproj/tap/kubectl-argo-rollouts",
			"kubectl krew install argo-rollouts",
		},
		ReleasesURL: "https://github.com/argoproj/argo-rollouts/releases",
	}
}
