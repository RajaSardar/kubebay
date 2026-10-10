package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/bridge"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
)

const mcpInstructions = "Kubebay is a Kubernetes desktop app. These tools read the clusters its user allowed: start with list_clusters, then pass a cluster ID to the others. Reads only, except propose_change, which changes nothing by itself: the user approves or rejects each proposal in Kubebay. Secrets are never available."

// newMCP builds the MCP endpoint (backlog #5): off until the user turns it
// on, and absent altogether in server mode.
func newMCP(sm *httpapi.SettingsManager, mgr *clusters.Manager, pools *informers.PoolRegistry, auditLog *audit.Logger, addr string, inCluster, oidc bool) *httpapi.MCPAPI {
	api := httpapi.NewMCPAPI(sm, fmt.Sprintf("http://%s/mcp", addr), httpapi.MCPBlockReason(inCluster, oidc, httpapi.IsLoopbackListenAddr(addr)))
	src := kubetools.PoolSource{Pools: pools, Manager: mgr}
	api.Proposals = proposals.New(src, auditLog.Record)
	reg := mcp.NewRegistry()
	kubetools.Register(reg, kubetools.Deps{
		Source:    src,
		Scope:     api.Scope,
		Audit:     auditLog.Record,
		Proposals: api.Proposals,
		Writes:    api.Writes,
	})
	api.Handler = &mcp.Handler{Tools: reg, Name: "kubebay", Version: version, Instructions: mcpInstructions}
	if exe, err := os.Executable(); err == nil {
		api.BridgeCommand = []string{exe, "mcp-stdio"}
	}
	return api
}

// runMCPStdio is the `mcp-stdio` subcommand. stdout carries only MCP
// messages; diagnostics go to stderr, which MCP clients log.
func runMCPStdio(args []string, in io.Reader, out, errw io.Writer) int {
	fs := flag.NewFlagSet("mcp-stdio", flag.ContinueOnError)
	fs.SetOutput(errw)
	def := os.Getenv("KUBEBAY_MCP_CONNECTION")
	if def == "" {
		if home, err := os.UserHomeDir(); err == nil {
			def = filepath.Join(home, ".kubebay", "mcp.json")
		}
	}
	conn := fs.String("connection", def, "Kubebay's MCP connection file (written when MCP is turned on)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := bridge.Run(ctx, in, out, bridge.Options{ConnectionFile: *conn, Log: errw}); err != nil {
		fmt.Fprintln(errw, "kubebay-mcp:", err)
		return 1
	}
	return 0
}
