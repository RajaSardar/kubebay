package main

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"k8s.io/client-go/tools/clientcmd"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/rolloutsdash"
)

// kubeconfigForContext returns the first kubeconfig file that defines the
// context. The dashboard is given that one file (KUBECONFIG and --kubeconfig),
// not the user's whole list, so it sees nothing else.
func kubeconfigForContext(paths []string, ctx string) (string, error) {
	for _, p := range paths {
		if p == "" {
			continue
		}
		cfg, err := clientcmd.LoadFromFile(p)
		if err != nil {
			continue
		}
		if _, ok := cfg.Contexts[ctx]; ok {
			return p, nil
		}
	}
	return "", fmt.Errorf("no kubeconfig file defines context %q", ctx)
}

// newRolloutsDash builds the Argo dashboard API (backlog 87). It is locked,
// with the reason, on a shared engine or a non-loopback listener: the plugin
// would run with the engine's identity. The manager is returned so main can
// stop it on disconnect and on quit.
func newRolloutsDash(mgr *clusters.Manager, auditLog *audit.Logger, log *slog.Logger, addr string, inCluster, sharedIdentity bool) (*httpapi.RolloutsDashAPI, *rolloutsdash.Manager) {
	home, _ := os.UserHomeDir()
	dm := &rolloutsdash.Manager{
		Locate: func() string { return rolloutsdash.Find(os.Getenv("PATH"), rolloutsdash.CommonPaths(home)) },
		Kubeconfig: func(id string) (string, string, error) {
			ctx, err := mgr.ContextName(id)
			if err != nil {
				return "", "", err
			}
			file, err := kubeconfigForContext(mgr.ActiveKubeconfigs(), ctx)
			return file, ctx, err
		},
		Env: os.Environ,
	}
	if home != "" {
		dm.DataDir = filepath.Join(home, ".kubebay")
	}
	api := &httpapi.RolloutsDashAPI{
		Svc:      dm,
		Disabled: httpapi.RolloutsDashBlockReason(inCluster, sharedIdentity, httpapi.IsLoopbackListenAddr(addr)),
		Known: func(id string) bool {
			_, err := mgr.ContextName(id)
			return err == nil
		},
		Audit: auditLog,
		Log:   log,
	}
	return api, dm
}
