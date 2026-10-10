package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"k8s.io/apimachinery/pkg/util/validation"

	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
)

// MCPSettings is the user's MCP choice (backlog #5): off by default, and
// when on, only the clusters (and, per cluster, namespaces) listed here.
type MCPSettings struct {
	Enabled bool `json:"enabled"`
	// Clusters maps a cluster ID to the namespaces an assistant may read
	// there; an empty list means every namespace.
	Clusters map[string][]string `json:"clusters,omitempty"`
	// Writes lets assistants propose changes (phase 2). A proposal changes
	// nothing until a person approves it in Kubebay.
	Writes bool `json:"writesEnabled,omitempty"`
}

// MCPBlockReason: the MCP endpoint hands a token holder the engine's own view
// of every cluster in scope, so it only exists for one user on one machine.
func MCPBlockReason(inCluster, oidcEnabled, loopbackOnly bool) string {
	switch {
	case oidcEnabled:
		return "the MCP server is off when OIDC is configured: one engine serves several people, and a token would see what the engine sees"
	case inCluster:
		return "the MCP server is off in in-cluster mode"
	case !loopbackOnly:
		return "the MCP server is only served on a loopback listener"
	}
	return ""
}

// MCPAPI owns the MCP endpoint's switch, scope and token. The token is
// separate from the UI's launch token, lives only in memory and in a 0600
// connection file the stdio bridge reads, and is replaced on every enable
// and rotate.
type MCPAPI struct {
	Settings *SettingsManager
	// Handler serves MCP itself (mcp.Handler); set after construction.
	Handler http.Handler
	URL     string
	// Disabled, when set, is why the endpoint doesn't exist here.
	Disabled string
	// BridgeCommand launches the stdio bridge (`<engine> mcp-stdio`), for
	// clients like Claude Desktop that only run local commands.
	BridgeCommand []string
	// Proposals holds assistants' proposed changes awaiting a decision.
	Proposals *proposals.Store

	mu    sync.RWMutex
	conf  MCPSettings
	token string
}

func mcpConnectionPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, settingsDir, "mcp.json"), nil
}

type mcpConnection struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	Note  string `json:"note"`
}

// NewMCPAPI restores the saved choice and, when MCP is on, its token.
func NewMCPAPI(sm *SettingsManager, url, disabled string) *MCPAPI {
	a := &MCPAPI{Settings: sm, URL: url, Disabled: disabled}
	if disabled != "" {
		return a
	}
	if set, err := sm.Load(); err == nil && set.MCP != nil {
		a.conf = *set.MCP
	}
	if a.conf.Enabled {
		if p, err := mcpConnectionPath(); err == nil {
			if b, err := os.ReadFile(p); err == nil {
				var c mcpConnection
				if json.Unmarshal(b, &c) == nil {
					a.token = c.Token
				}
			}
		}
		if a.token == "" {
			// Enabled with no connection file (deleted by hand): mint a new one.
			_ = a.mintToken()
		}
	}
	return a
}

// Scope is what the tools may read, as of now.
// Writes reports whether assistants may propose changes right now.
func (a *MCPAPI) Writes() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.conf.Enabled && a.conf.Writes
}

func (a *MCPAPI) Scope() kubetools.Scope {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if !a.conf.Enabled {
		return kubetools.Scope{}
	}
	out := make(map[string][]string, len(a.conf.Clusters))
	for c, ns := range a.conf.Clusters {
		out[c] = append([]string(nil), ns...)
	}
	return kubetools.Scope{Clusters: out}
}

// mintToken replaces the token and rewrites the connection file. Caller
// holds no lock.
func (a *MCPAPI) mintToken() error {
	tok, err := NewToken()
	if err != nil {
		return err
	}
	p, err := mcpConnectionPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(mcpConnection{
		URL:   a.URL,
		Token: tok,
		Note:  "Kubebay MCP connection. Read by kubebay-mcp; replaced when the token is rotated or MCP is turned off.",
	}, "", "  ")
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	a.mu.Lock()
	a.token = tok
	a.mu.Unlock()
	return nil
}

func (a *MCPAPI) revokeToken() {
	a.mu.Lock()
	a.token = ""
	a.mu.Unlock()
	if p, err := mcpConnectionPath(); err == nil {
		_ = os.Remove(p)
	}
}

// Endpoint is /mcp: refused unless MCP is on, the request carries no
// browser Origin, and it presents the MCP token as a Bearer token. The UI's
// launch token and OIDC cookies are never accepted here.
func (a *MCPAPI) Endpoint() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.Disabled != "" || a.Handler == nil {
			http.NotFound(w, r)
			return
		}
		a.mu.RLock()
		enabled, token := a.conf.Enabled, a.token
		a.mu.RUnlock()
		if !enabled || token == "" {
			http.Error(w, "the MCP server is off in Kubebay (Settings → MCP)", http.StatusForbidden)
			return
		}
		if r.Header.Get("Origin") != "" {
			http.Error(w, "browser origins are not allowed", http.StatusForbidden)
			return
		}
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") || !tokenMatches(strings.TrimPrefix(auth, "Bearer "), token) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="kubebay-mcp"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		a.Handler.ServeHTTP(w, r)
	})
}

type mcpStatus struct {
	MCPSettings
	URL            string   `json:"url"`
	ConnectionFile string   `json:"connectionFile,omitempty"`
	Disabled       string   `json:"disabled,omitempty"`
	BridgeCommand  []string `json:"bridgeCommand,omitempty"`
}

func (a *MCPAPI) status() mcpStatus {
	a.mu.RLock()
	defer a.mu.RUnlock()
	st := mcpStatus{MCPSettings: a.conf, URL: a.URL, Disabled: a.Disabled, BridgeCommand: a.BridgeCommand}
	if st.Clusters == nil {
		st.Clusters = map[string][]string{}
	}
	if a.conf.Enabled && a.token != "" {
		st.ConnectionFile, _ = mcpConnectionPath()
	}
	return st
}

// HandleGet reports the switch, scope and where the connection file is.
// Never the token: the bridge reads it from the file.
func (a *MCPAPI) HandleGet(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, a.status())
}

// HandleSave turns MCP on or off and sets its scope. Turning it on mints a
// token; turning it off revokes it, so the switch is also the kill switch.
func (a *MCPAPI) HandleSave(w http.ResponseWriter, r *http.Request) {
	if a.Disabled != "" {
		http.Error(w, a.Disabled, http.StatusForbidden)
		return
	}
	var body MCPSettings
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	for c, nss := range body.Clusters {
		if strings.TrimSpace(c) == "" {
			http.Error(w, "empty cluster ID", http.StatusBadRequest)
			return
		}
		for _, ns := range nss {
			if errs := validation.IsDNS1123Label(ns); len(errs) > 0 {
				http.Error(w, fmt.Sprintf("namespace %q: %s", ns, strings.Join(errs, "; ")), http.StatusBadRequest)
				return
			}
		}
	}
	if err := a.Settings.saveMCP(&body); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	a.mu.Lock()
	wasOn := a.conf.Enabled && a.token != ""
	a.conf = body
	a.mu.Unlock()
	if (!body.Enabled || !body.Writes) && a.Proposals != nil {
		a.Proposals.RejectAll("proposals were turned off in Kubebay")
	}
	switch {
	case body.Enabled && !wasOn:
		if err := a.mintToken(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	case !body.Enabled:
		a.revokeToken()
	}
	writeJSON(w, a.status())
}

// HandleRotate replaces the token. The bridge re-reads the connection file
// on every request, so connected assistants keep working.
func (a *MCPAPI) HandleRotate(w http.ResponseWriter, _ *http.Request) {
	if a.Disabled != "" {
		http.Error(w, a.Disabled, http.StatusForbidden)
		return
	}
	a.mu.RLock()
	on := a.conf.Enabled
	a.mu.RUnlock()
	if !on {
		http.Error(w, "turn MCP on first", http.StatusConflict)
		return
	}
	if err := a.mintToken(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, a.status())
}

// HandleProposals lists what assistants proposed: pending first, for the
// approval dialog, and the latest decisions.
func (a *MCPAPI) HandleProposals(w http.ResponseWriter, _ *http.Request) {
	if a.Disabled != "" || a.Proposals == nil {
		writeJSON(w, map[string]any{"pending": []proposals.Proposal{}, "recent": []proposals.Proposal{}, "writesEnabled": false})
		return
	}
	recent := a.Proposals.Recent()
	if len(recent) > 20 {
		recent = recent[:20]
	}
	writeJSON(w, map[string]any{"pending": a.Proposals.Pending(), "recent": recent, "writesEnabled": a.Writes()})
}

// inWriteScope: proposals are on, and the cluster and namespace are still
// in scope now, not just when the proposal was made.
func (a *MCPAPI) inWriteScope(cluster, ns string) error {
	if !a.Writes() {
		return fmt.Errorf("proposals are turned off")
	}
	allowed, ok := a.Scope().Clusters[cluster]
	if !ok {
		return fmt.Errorf("cluster %q is no longer in the MCP scope", cluster)
	}
	if len(allowed) > 0 {
		for _, n := range allowed {
			if n == ns {
				return nil
			}
		}
		return fmt.Errorf("namespace %q is no longer in the MCP scope", ns)
	}
	return nil
}

// HandleApprove applies one proposal. Only the UI's token reaches it.
func (a *MCPAPI) HandleApprove(w http.ResponseWriter, r *http.Request) {
	if a.Disabled != "" || a.Proposals == nil {
		http.Error(w, "proposals are not available here", http.StatusForbidden)
		return
	}
	id := chi.URLParam(r, "id")
	p, ok := a.Proposals.Get(id)
	if !ok {
		http.Error(w, "no proposal "+id, http.StatusNotFound)
		return
	}
	if err := a.inWriteScope(p.Cluster, p.Namespace); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	out, err := a.Proposals.Approve(r.Context(), id)
	switch {
	case err == nil:
		writeJSON(w, out)
	case out.Status == proposals.StatusFailed:
		http.Error(w, err.Error(), http.StatusBadGateway)
	default:
		http.Error(w, err.Error(), http.StatusConflict)
	}
}

// HandleReject closes one proposal without applying it.
func (a *MCPAPI) HandleReject(w http.ResponseWriter, r *http.Request) {
	if a.Disabled != "" || a.Proposals == nil {
		http.Error(w, "proposals are not available here", http.StatusForbidden)
		return
	}
	id := chi.URLParam(r, "id")
	if _, ok := a.Proposals.Get(id); !ok {
		http.Error(w, "no proposal "+id, http.StatusNotFound)
		return
	}
	out, err := a.Proposals.Reject(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, out)
}
