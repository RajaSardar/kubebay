package main

import (
	"os"

	"github.com/RajaSardar/kubebay/engine/internal/aiinvest"
	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
)

// newAI builds the AI investigation API (backlog 78). It is locked, with the
// reason, on a shared engine or a non-loopback listener. mcpAPI and auditLog
// may be nil only in tests of the lock.
func newAI(mcpAPI *httpapi.MCPAPI, auditLog *audit.Logger, addr string, inCluster, sharedIdentity bool) *httpapi.AIAPI {
	home, _ := os.UserHomeDir()
	var record func(audit.Entry)
	if auditLog != nil {
		record = auditLog.Record
	}
	m := &aiinvest.Manager{
		Locate:   func() string { return aiinvest.Find(os.Getenv("PATH"), aiinvest.CommonPaths(home)) },
		Env:      os.Environ,
		Limits:   aiinvest.DefaultLimits(),
		TempRoot: "",
		Audit:    record,
	}
	if mcpAPI != nil {
		m.MCPURL = mcpAPI.URL
		m.Mint = mcpAPI.MintRunToken
		for _, t := range mcpAPI.RunTools {
			m.Allowed = append(m.Allowed, aiinvest.ToolPrefix+t)
		}
	}
	return &httpapi.AIAPI{
		Manager:   m,
		PrefsPath: httpapi.DefaultAIPrefsPath(),
		Disabled:  httpapi.AIBlockReason(inCluster, sharedIdentity, httpapi.IsLoopbackListenAddr(addr)),
		Audit:     record,
	}
}
