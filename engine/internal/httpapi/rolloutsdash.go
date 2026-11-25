package httpapi

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/rolloutsdash"
)

// RolloutsDashBlockReason is why the Argo dashboard tab is off on this engine,
// or "". The plugin runs with the user's kubeconfig on the user's machine, so
// it exists only for one person on a local, loopback-only engine: on a shared
// engine (in-cluster, OIDC, an auth proxy) it would run with the engine's
// identity for everyone, and on a non-loopback listener the proxy would be
// reachable from other hosts.
func RolloutsDashBlockReason(inCluster, sharedIdentity, loopbackOnly bool) string {
	switch {
	case sharedIdentity:
		return "the Argo dashboard is off when OIDC or an auth proxy is configured: it would run with the engine's identity for everyone"
	case inCluster:
		return "the Argo dashboard is off in in-cluster mode: it would run with the engine's identity"
	case !loopbackOnly:
		return "the Argo dashboard is only available on a loopback listener"
	}
	return ""
}

// RolloutsDashService is what the API needs from rolloutsdash.Manager.
type RolloutsDashService interface {
	Status(cluster string) rolloutsdash.Status
	Start(ctx context.Context, cluster string, namespaces []string) (rolloutsdash.Status, error)
	Heartbeat(cluster string) bool
	Release(cluster string)
	Acquire(token string) (port int, release func(), ok bool)
}

// RolloutsDashAPI serves /api/rollouts-dashboard (backlog 87): control routes
// inside the session-token group, and the same-origin reverse proxy the
// iframe loads, which is the one route outside it.
type RolloutsDashAPI struct {
	Svc RolloutsDashService
	// Disabled is RolloutsDashBlockReason's answer. Set, start and the
	// control routes answer 403, status says why, and the proxy is not mounted.
	Disabled string
	// Known says whether a cluster id exists.
	Known func(id string) bool
	Audit *audit.Logger
	Log   *slog.Logger
}

// Routes registers the control routes (inside the launch-token group).
func (a *RolloutsDashAPI) Routes(r chi.Router) {
	r.Get("/api/rollouts-dashboard/status", a.handleStatus)
	r.Post("/api/rollouts-dashboard/start", a.guard(a.handleStart))
	r.Post("/api/rollouts-dashboard/heartbeat", a.guard(a.handleHeartbeat))
	r.Post("/api/rollouts-dashboard/release", a.guard(a.handleRelease))
}

// ProxyRoute mounts the iframe's route, outside the session-token group: an
// iframe cannot send the Authorization header, so the per-run path token is
// the credential. Not mounted at all when the dashboard is disabled.
func (a *RolloutsDashAPI) ProxyRoute(r chi.Router) {
	if a.Disabled != "" {
		return
	}
	r.HandleFunc("/api/rollouts-dashboard/{token}/*", a.handleProxy)
}

func (a *RolloutsDashAPI) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.Disabled != "" {
			http.Error(w, a.Disabled, http.StatusForbidden)
			return
		}
		if o := r.Header.Get("Origin"); o != "" {
			if u, err := url.Parse(o); err != nil || u.Host != r.Host {
				http.Error(w, "foreign origin", http.StatusForbidden)
				return
			}
		}
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
			return
		}
		next(w, r)
	}
}

type dashBody struct {
	Cluster    string   `json:"cluster"`
	Namespaces []string `json:"namespaces"`
}

func (a *RolloutsDashAPI) handleStatus(w http.ResponseWriter, r *http.Request) {
	if a.Disabled != "" {
		writeJSON(w, map[string]string{"state": "unavailable", "reason": a.Disabled})
		return
	}
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" || (a.Known != nil && !a.Known(cluster)) {
		http.Error(w, "unknown cluster", http.StatusNotFound)
		return
	}
	writeJSON(w, a.Svc.Status(cluster))
}

func (a *RolloutsDashAPI) body(w http.ResponseWriter, r *http.Request) (dashBody, bool) {
	var b dashBody
	if err := decodeBody(r, &b); err != nil || b.Cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return b, false
	}
	if a.Known != nil && !a.Known(b.Cluster) {
		http.Error(w, "unknown cluster", http.StatusNotFound)
		return b, false
	}
	return b, true
}

func (a *RolloutsDashAPI) handleStart(w http.ResponseWriter, r *http.Request) {
	b, ok := a.body(w, r)
	if !ok {
		return
	}
	before := a.Svc.Status(b.Cluster).State
	st, err := a.Svc.Start(r.Context(), b.Cluster, b.Namespaces)
	if err != nil {
		code := http.StatusInternalServerError
		if err == rolloutsdash.ErrCapReached {
			code = http.StatusTooManyRequests
		}
		http.Error(w, err.Error(), code)
		return
	}
	// One entry per process started: reusing a running dashboard is not a start.
	if st.State == rolloutsdash.StateRunning && before != rolloutsdash.StateRunning && before != rolloutsdash.StateStarting && a.Audit != nil {
		detail := "namespaces=all"
		if len(b.Namespaces) > 0 {
			detail = "namespaces=" + strings.Join(b.Namespaces, ",")
		}
		a.Audit.RecordCtx(r.Context(), audit.Entry{
			Action:    "rollouts-dashboard-start",
			Cluster:   b.Cluster,
			GVR:       "rollouts-dashboard",
			Detail:    detail,
			UserAgent: r.Header.Get("User-Agent"),
			Source:    "rollouts-dashboard",
		})
	}
	writeJSON(w, st)
}

func (a *RolloutsDashAPI) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	b, ok := a.body(w, r)
	if !ok {
		return
	}
	writeJSON(w, map[string]bool{"alive": a.Svc.Heartbeat(b.Cluster)})
}

func (a *RolloutsDashAPI) handleRelease(w http.ResponseWriter, r *http.Request) {
	b, ok := a.body(w, r)
	if !ok {
		return
	}
	a.Svc.Release(b.Cluster)
	writeJSON(w, map[string]bool{"ok": true})
}

// frameCSP is the policy on proxied responses. The frame runs sandboxed
// without allow-same-origin, so it has an opaque origin and cannot reach the
// shell's storage, cookies or session token, whatever the upstream page does.
const frameCSP = "sandbox allow-scripts allow-forms; frame-ancestors 'self'; " +
	"default-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
	"connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"

func hostOnly(hostport string) string {
	h, _, err := net.SplitHostPort(hostport)
	if err != nil {
		return hostport
	}
	return h
}

func (a *RolloutsDashAPI) handleProxy(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	// Backstop, not the control: a rebound DNS name or a spoofed Host is refused.
	if !isLoopbackHost(hostOnly(r.Host)) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	// The sandboxed frame's own requests carry Origin: null; the shell's carry
	// its own origin. Any other site is refused.
	origin := r.Header.Get("Origin")
	if origin != "" && origin != "null" {
		if u, err := url.Parse(origin); err != nil || u.Host != r.Host {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}
	port, release, ok := a.Svc.Acquire(token)
	if !ok {
		http.NotFound(w, r)
		return
	}
	defer release()

	h := w.Header()
	// Set on the writer, over the shell's DENY, and removed from the upstream
	// response below so the two never stack.
	h.Set("X-Frame-Options", "SAMEORIGIN")
	h.Set("Content-Security-Policy", frameCSP)
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	if origin == "null" {
		h.Set("Access-Control-Allow-Origin", "null")
		h.Add("Vary", "Origin")
	}
	if r.Method == http.MethodOptions {
		h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE")
		h.Set("Access-Control-Allow-Headers", "Content-Type, Accept")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	target := &url.URL{Scheme: "http", Host: net.JoinHostPort("127.0.0.1", strconv.Itoa(port))}
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			// Nothing of Kubebay's identity goes upstream, and the upstream is
			// told nothing about who is asking.
			for k := range pr.Out.Header {
				if strings.HasPrefix(strings.ToLower(k), "x-kubebay-") || strings.HasPrefix(strings.ToLower(k), "sec-fetch-") {
					delete(pr.Out.Header, k)
				}
			}
			for _, k := range []string{"Authorization", "Cookie", "Origin", "Referer", "Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto"} {
				pr.Out.Header.Del(k)
			}
		},
		FlushInterval: -1, // SSE and streamed responses reach the page as they arrive
		ModifyResponse: func(res *http.Response) error {
			for _, k := range []string{"Set-Cookie", "X-Frame-Options", "Content-Security-Policy", "Cache-Control", "Referrer-Policy"} {
				res.Header.Del(k)
			}
			for k := range res.Header {
				if strings.HasPrefix(strings.ToLower(k), "access-control-") {
					delete(res.Header, k)
				}
			}
			if loc := res.Header.Get("Location"); loc != "" && !strings.HasPrefix(loc, "/") {
				res.Header.Del("Location")
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			if a.Log != nil {
				a.Log.Warn("rollouts dashboard proxy error", "err", strings.ReplaceAll(err.Error(), token, "[token]"))
			}
			http.Error(w, "the Argo dashboard is not reachable", http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}
