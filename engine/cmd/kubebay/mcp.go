package main

import (
	"fmt"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

const mcpInstructions = "Kubebay is a Kubernetes desktop app. These tools read the clusters its user allowed: start with list_clusters, then pass a cluster ID to the others. Everything is read-only; Secrets are never available."

// newMCP builds the MCP endpoint (backlog #5): off until the user turns it
// on, and absent altogether in server mode.
func newMCP(sm *httpapi.SettingsManager, mgr *clusters.Manager, pools *informers.PoolRegistry, auditLog *audit.Logger, addr string, inCluster, oidc bool) *httpapi.MCPAPI {
	api := httpapi.NewMCPAPI(sm, fmt.Sprintf("http://%s/mcp", addr), httpapi.MCPBlockReason(inCluster, oidc, httpapi.IsLoopbackListenAddr(addr)))
	reg := mcp.NewRegistry()
	kubetools.Register(reg, kubetools.Deps{
		Source: kubetools.PoolSource{Pools: pools, Manager: mgr},
		Scope:  api.Scope,
		Audit:  auditLog.Record,
	})
	api.Handler = &mcp.Handler{Tools: reg, Name: "kubebay", Version: version, Instructions: mcpInstructions}
	return api
}
