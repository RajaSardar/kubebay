package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/RajaSardar/kubebay/engine/internal/aiinvest"
	"github.com/RajaSardar/kubebay/engine/internal/audit"
)

// AIBlockReason is why AI investigations are off on this engine, or "". It is
// composed from MCPBlockReason because a run reaches the engine through the
// MCP endpoint and spawns a process: both only make sense for one person on
// one machine. A shared engine (in-cluster, OIDC or an auth proxy) never runs
// a binary for another person's request.
func AIBlockReason(inCluster, oidcEnabled, loopbackOnly bool) string {
	if r := MCPBlockReason(inCluster, oidcEnabled, loopbackOnly); r != "" {
		return "AI investigations are off here: " + r
	}
	return ""
}

type aiPrefs struct {
	Enabled       *bool `json:"enabled,omitempty"`
	NoticeVersion int   `json:"noticeVersion,omitempty"`
}

func (p aiPrefs) on() bool { return p.Enabled == nil || *p.Enabled }

// AIAPI serves /api/ai/*: status, the first-run notice, the per-user switch
// and the investigations themselves (backlog 78). Claude Code only.
type AIAPI struct {
	Manager *aiinvest.Manager
	// PrefsPath is the per-user file (~/.kubebay/ai.json), never the shared settings file.
	PrefsPath string
	// Disabled is AIBlockReason's answer; set, every route answers 403.
	Disabled string
	Audit    func(audit.Entry)

	mu sync.Mutex
}

// DefaultAIPrefsPath is ~/.kubebay/ai.json.
func DefaultAIPrefsPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, settingsDir, "ai.json")
}

func (a *AIAPI) loadPrefs() aiPrefs {
	var p aiPrefs
	if b, err := os.ReadFile(a.PrefsPath); err == nil {
		_ = json.Unmarshal(b, &p)
	}
	return p
}

func (a *AIAPI) savePrefs(p aiPrefs) error {
	if a.PrefsPath == "" {
		return fmt.Errorf("no home directory")
	}
	if err := os.MkdirAll(filepath.Dir(a.PrefsPath), 0o700); err != nil {
		return err
	}
	b, _ := json.Marshal(p)
	tmp := a.PrefsPath + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, a.PrefsPath)
}

// guard runs first on every route: a locked engine answers 403 before
// anything is read or written; a request from a foreign browser Origin is
// refused; a POST must be JSON (so a cross-site form cannot reach it).
func (a *AIAPI) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.Disabled != "" {
			http.Error(w, a.Disabled, http.StatusForbidden)
			return
		}
		if o := r.Header.Get("Origin"); o != "" {
			u, err := url.Parse(o)
			if err != nil || u.Host != r.Host {
				http.Error(w, "foreign origin", http.StatusForbidden)
				return
			}
		}
		if r.Method == http.MethodPost && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
			return
		}
		next(w, r)
	}
}

// Routes registers the AI routes on r (inside the launch-token group).
func (a *AIAPI) Routes(r chi.Router) {
	// Status answers even when locked, with the reason, so the UI can show it.
	r.Get("/api/ai/status", a.handleStatus)
	r.Post("/api/ai/settings", a.guard(a.handleSettings))
	r.Post("/api/ai/notice", a.guard(a.handleNotice))
	r.Post("/api/ai/investigations", a.guard(a.handleStart))
	r.Get("/api/ai/investigations/{id}/events", a.guard(a.handleEvents))
	r.Delete("/api/ai/investigations/{id}", a.guard(a.handleStop))
}

func (a *AIAPI) state() (string, aiPrefs, string) {
	if a.Disabled != "" {
		return "locked", aiPrefs{}, ""
	}
	p := a.loadPrefs()
	claude := a.Manager.Find()
	switch {
	case !p.on():
		return "off-by-user", p, claude
	case claude == "":
		return "no-claude", p, claude
	case p.NoticeVersion < aiinvest.NoticeVersion:
		return "notice-needed", p, claude
	}
	return "ready", p, claude
}

func (a *AIAPI) handleStatus(w http.ResponseWriter, r *http.Request) {
	if o := r.Header.Get("Origin"); o != "" {
		if u, err := url.Parse(o); err != nil || u.Host != r.Host {
			http.Error(w, "foreign origin", http.StatusForbidden)
			return
		}
	}
	st, p, claude := a.state()
	l := a.Manager.Limits
	out := map[string]any{
		"state": st, "enabled": p.on(), "noticeVersion": aiinvest.NoticeVersion,
		"limits": map[string]any{"seconds": int(l.Wall / time.Second), "bytes": l.MaxOutput},
	}
	switch st {
	case "locked":
		out["reason"] = a.Disabled
		out["enabled"] = false
	case "no-claude":
		out["installHelp"] = aiinvest.InstallHelp
	case "notice-needed":
		out["notice"] = aiinvest.Notice
		out["claudePath"] = claude
	default:
		out["claudePath"] = claude
		out["notice"] = aiinvest.Notice
	}
	writeJSON(w, out)
}

func (a *AIAPI) record(r *http.Request, action, detail string) {
	if a.Audit != nil {
		a.Audit(audit.Entry{Time: time.Now(), Action: action, GVR: "ai/investigations", User: audit.UserFrom(r.Context()), Detail: detail, Source: "ai-investigation"})
	}
}

func (a *AIAPI) handleSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeBody(r, &body); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	a.mu.Lock()
	p := a.loadPrefs()
	p.Enabled = &body.Enabled
	err := a.savePrefs(p)
	a.mu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	a.record(r, "ai-investigation-setting", fmt.Sprintf("enabled=%v", body.Enabled))
	a.handleStatus(w, r)
}

func (a *AIAPI) handleNotice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version int `json:"version"`
	}
	if err := decodeBody(r, &body); err != nil || body.Version != aiinvest.NoticeVersion {
		http.Error(w, "accept the current notice version", http.StatusBadRequest)
		return
	}
	a.mu.Lock()
	p := a.loadPrefs()
	p.NoticeVersion = body.Version
	err := a.savePrefs(p)
	a.mu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	a.record(r, "ai-investigation-notice", fmt.Sprintf("accepted version=%d", body.Version))
	a.handleStatus(w, r)
}

func (a *AIAPI) handleStart(w http.ResponseWriter, r *http.Request) {
	st, _, _ := a.state()
	switch st {
	case "off-by-user":
		http.Error(w, "AI investigations are turned off in Settings", http.StatusConflict)
		return
	case "no-claude":
		http.Error(w, aiinvest.InstallHelp, http.StatusConflict)
		return
	case "notice-needed":
		http.Error(w, "accept the first-run notice first", http.StatusPreconditionFailed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var req aiinvest.Request
	if err := decodeBody(r, &req); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	inv, err := a.Manager.Start(audit.UserFrom(r.Context()), req)
	switch err {
	case nil:
		writeJSON(w, map[string]string{"id": inv.ID})
	case aiinvest.ErrBusy:
		http.Error(w, err.Error(), http.StatusTooManyRequests)
	case aiinvest.ErrNoClaude:
		http.Error(w, aiinvest.InstallHelp, http.StatusConflict)
	default:
		http.Error(w, err.Error(), http.StatusBadRequest)
	}
}

// own returns the run if it exists and belongs to the caller.
func (a *AIAPI) own(w http.ResponseWriter, r *http.Request) *aiinvest.Investigation {
	inv, ok := a.Manager.Get(chi.URLParam(r, "id"))
	if !ok || inv.User != audit.UserFrom(r.Context()) {
		http.Error(w, "no such investigation", http.StatusNotFound)
		return nil
	}
	return inv
}

func (a *AIAPI) handleStop(w http.ResponseWriter, r *http.Request) {
	if inv := a.own(w, r); inv != nil {
		inv.Stop()
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleEvents streams the run as server-sent events. Leaving the page stops
// the run: nobody is watching, and a run never outlives its viewer.
func (a *AIAPI) handleEvents(w http.ResponseWriter, r *http.Request) {
	inv := a.own(w, r)
	if inv == nil {
		return
	}
	fl, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	for i := 0; ; {
		evs, done := inv.Wait(r.Context(), i)
		if r.Context().Err() != nil {
			inv.Stop()
			return
		}
		for _, e := range evs {
			b, _ := json.Marshal(e)
			fmt.Fprintf(w, "data: %s\n\n", b)
		}
		i += len(evs)
		if fl != nil {
			fl.Flush()
		}
		if done {
			return
		}
	}
}
