package rolloutsdash

import (
	"os"
	"strings"
)

// BuildEnv is the plugin's whole environment: HOME and PATH (so a kubeconfig
// exec plugin such as aws or gke-gcloud-auth-plugin still resolves), LANG, and
// KUBECONFIG pointing at the single file that defines the cluster's context.
// Nothing from the parent beyond that: no KUBEBAY_* token, no cloud keys, no
// other kubeconfig files.
func BuildEnv(parent []string, kubeconfig, binDir string) []string {
	keep := map[string]bool{
		"HOME": true, "LANG": true,
		// Windows needs these to find a profile and run anything at all.
		"USERPROFILE": true, "APPDATA": true, "LOCALAPPDATA": true, "SYSTEMROOT": true, "TEMP": true, "TMP": true,
	}
	var path string
	var out []string
	for _, kv := range parent {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		switch {
		case k == "PATH":
			path = v
		case keep[k] || strings.HasPrefix(k, "LC_"):
			out = append(out, kv)
		}
	}
	if binDir != "" {
		if path != "" {
			path = binDir + string(os.PathListSeparator) + path
		} else {
			path = binDir
		}
	}
	out = append(out, "PATH="+path, "KUBECONFIG="+kubeconfig)
	return out
}
