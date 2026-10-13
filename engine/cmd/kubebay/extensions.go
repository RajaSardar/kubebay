package main

import (
	"os"
	"path/filepath"

	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
)

// newExtensions serves ~/.kubebay/extensions.yaml (KB-13). Kubebay never
// writes the file; it only reads what the user put there.
func newExtensions(sm *httpapi.SettingsManager, inCluster, oidc bool) *httpapi.ExtensionsAPI {
	api := &httpapi.ExtensionsAPI{
		Disabled:   httpapi.ExtensionsBlockReason(inCluster, oidc),
		LocalShell: func() httpapi.LocalShellStatus { return sm.LocalShell },
	}
	home, err := os.UserHomeDir()
	if err != nil {
		if api.Disabled == "" {
			api.Disabled = "extensions are read from ~/.kubebay/extensions.yaml, and this engine has no home directory"
		}
		return api
	}
	api.Path = filepath.Join(home, ".kubebay", "extensions.yaml")
	return api
}
