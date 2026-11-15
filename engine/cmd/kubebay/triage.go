package main

import (
	"context"
	"os"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/keychain"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

// newTriage builds incident triage (backlog #13): off until the user turns
// it on for a cluster, its key in the OS keychain or the environment, and
// absent in server mode. Evidence is the same assembler MCP's tools share.
func newTriage(sm *httpapi.SettingsManager, mgr *clusters.Manager, pools *informers.PoolRegistry, auditLog *audit.Logger, inCluster, oidc bool) *httpapi.TriageAPI {
	src := kubetools.PoolSource{Pools: pools, Manager: mgr}
	return &httpapi.TriageAPI{
		Settings: sm,
		Keys:     keychain.System(),
		Getenv:   os.Getenv,
		Audit:    auditLog.Record,
		Disabled: httpapi.TriageBlockReason(inCluster, oidc),
		Evidence: func(ctx context.Context, cluster, ns, pod string) (kubetools.Evidence, error) {
			return kubetools.BuildEvidence(ctx, src, cluster, ns, pod, 0)
		},
	}
}
