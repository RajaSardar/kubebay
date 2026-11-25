package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

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
		return "the MCP server is off when OIDC or an auth proxy is configured: one engine serves several people, and a token would see what the engine sees"
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
	// RunHandlerFor builds the read-only MCP handler a per-run token reaches
	// (AI investigations, backlog 78): no write or proposal tool exists on
	// it, and its scope is the one cluster (and namespace) of the run.
	RunHandlerFor func(scope kubetools.Scope) http.Handler
	// RunTools are the exact read-tool names (without the server prefix) a
	// run may call; set with RunHandlerFor.
	RunTools []string
	// now is the clock; nil means time.Now.
	now  func() time.Time
	runs map[string]runGrant

	mu sync.RWMutex
	// readOnlyReason, when set, is the operator's flag or env forcing writes off.
	readOnlyReason string
	conf           MCPSettings
	token          string
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
	return a.conf.Enabled && a.conf.Writes && a.readOnlyReason == ""
}

// ForceReadOnly turns assistants' write tools off whatever the user saved
// (the stored choice is left alone), with reason shown beside the locked
// toggle. Called once at startup from --mcp-read-only / KUBEBAY_MCP_READ_ONLY.
func (a *MCPAPI) ForceReadOnly(reason string) {
	a.mu.Lock()
	a.readOnlyReason = reason
	a.mu.Unlock()
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

func (a *MCPAPI) clock() time.Time {
	if a.now != nil {
		return a.now()
	}
	return time.Now()
}

// runGrant is one live per-run token.
type runGrant struct {
	expires time.Time
	handler http.Handler
}

// MintRunToken makes a short-lived token for one AI investigation run
// (backlog 78). It is separate from the user's long-lived MCP token, held in
// memory only, bound to ONE cluster (and the issue's namespace), always
// read-only, and works whether or not the user switched MCP on. The scope is
// the intersection with the clusters and namespaces the user limited
// assistants to, when they set any: a limit they chose is never widened.
// The returned func revokes it; call it when the run ends.
func (a *MCPAPI) MintRunToken(cluster, namespace string, ttl time.Duration) (string, func(), error) {
	if a.Disabled != "" {
		return "", nil, fmt.Errorf("AI investigations are off here: %s", a.Disabled)
	}
	if a.RunHandlerFor == nil {
		return "", nil, fmt.Errorf("the read-only MCP mount is not available")
	}
	if strings.TrimSpace(cluster) == "" {
		return "", nil, fmt.Errorf("a cluster is required")
	}
	a.mu.RLock()
	limit := a.conf.Clusters
	a.mu.RUnlock()
	var nss []string
	if len(limit) > 0 {
		allowed, ok := limit[cluster]
		if !ok {
			return "", nil, fmt.Errorf("cluster %q is outside the clusters you allowed assistants to read (Settings → MCP)", cluster)
		}
		switch {
		case namespace != "" && len(allowed) > 0:
			found := false
			for _, n := range allowed {
				found = found || n == namespace
			}
			if !found {
				return "", nil, fmt.Errorf("namespace %q is outside the namespaces you allowed assistants to read (Settings → MCP)", namespace)
			}
			nss = []string{namespace}
		case namespace != "":
			nss = []string{namespace}
		default:
			nss = append([]string(nil), allowed...)
		}
	} else if namespace != "" {
		nss = []string{namespace}
	}
	h := a.RunHandlerFor(kubetools.Scope{Clusters: map[string][]string{cluster: nss}})
	if h == nil {
		return "", nil, fmt.Errorf("the read-only MCP mount is not available")
	}
	tok, err := NewToken()
	if err != nil {
		return "", nil, err
	}
	a.mu.Lock()
	if a.runs == nil {
		a.runs = map[string]runGrant{}
	}
	a.runs[tok] = runGrant{expires: a.clock().Add(ttl), handler: h}
	a.mu.Unlock()
	return tok, func() {
		a.mu.Lock()
		delete(a.runs, tok)
		a.mu.Unlock()
	}, nil
}

// runHandler returns the handler for a live run token, or nil.
func (a *MCPAPI) runHandler(bearer string) http.Handler {
	a.mu.RLock()
	defer a.mu.RUnlock()
	for tok, g := range a.runs {
		if tokenMatches(bearer, tok) {
			if a.clock().After(g.expires) {
				return nil
			}
			return g.handler
		}
	}
	return nil
}

// Endpoint is /mcp: refused unless MCP is on, the request carries no
// browser Origin, and it presents the MCP token as a Bearer token. The UI's
// launch token and OIDC cookies are never accepted here.
func (a *MCPAPI) Endpoint() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.Disabled != "" {
			http.NotFound(w, r)
			return
		}
		// A per-run token is looked up first: it works with the user's MCP
		// switch off, and is checked before that gate on purpose.
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			if h := a.runHandler(strings.TrimPrefix(auth, "Bearer ")); h != nil {
				if r.Header.Get("Origin") != "" {
					http.Error(w, "browser origins are not allowed", http.StatusForbidden)
					return
				}
				h.ServeHTTP(w, r)
				return
			}
		}
		if a.Handler == nil {
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
	// ReadOnlyForced and ReadOnlyReason: an operator switched writes off.
	ReadOnlyForced bool   `json:"readOnlyForced,omitempty"`
	ReadOnlyReason string `json:"readOnlyReason,omitempty"`
}

func (a *MCPAPI) status() mcpStatus {
	a.mu.RLock()
	defer a.mu.RUnlock()
	st := mcpStatus{MCPSettings: a.conf, URL: a.URL, Disabled: a.Disabled, BridgeCommand: a.BridgeCommand,
		ReadOnlyForced: a.readOnlyReason != "", ReadOnlyReason: a.readOnlyReason}
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
	if (!body.Enabled || !body.Writes || !a.Writes()) && a.Proposals != nil {
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
