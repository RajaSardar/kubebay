package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

type Deps struct {
	Log       *slog.Logger
	Clusters  *clusters.Manager
	Pools     *informers.PoolRegistry
	Hub       *stream.Hub
	Channels  *Channels
	PF        *PFManager
	Actions   *Actions
	Metrics   *Metrics
	RBAC      *RBAC
	Helm      *HelmManager
	NodeShell *NodeShellManager
	Settings  *SettingsManager
	Auth      *Authenticator
	Audit     *audit.Logger
}

func (d Deps) authEnabled() bool { return d.Auth != nil && d.Auth.Enabled() }

func NewChannels(mgr *clusters.Manager, auditLog *audit.Logger) *Channels {
	return &Channels{Clusters: mgr, Audit: auditLog}
}

func NewToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func Router(d Deps, token string) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/api/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]bool{"ok": true})
	})

	// Tells the UI how to authenticate without leaking anything: whether to send
	// the user to the OIDC login or to ask for the launch token. Public because
	// the UI has to ask it before it has any credential at all.
	r.Get("/api/auth-mode", func(w http.ResponseWriter, _ *http.Request) {
		mode := "open"
		switch {
		case d.authEnabled():
			mode = "oidc"
		case token != "":
			mode = "token"
		}
		writeJSON(w, map[string]string{"mode": mode})
	})

	if d.authEnabled() {
		r.Route("/api/auth", func(r chi.Router) {
			r.Get("/login", d.Auth.HandleLogin)
			r.Get("/callback", d.Auth.HandleCallback)
			r.Get("/me", func(w http.ResponseWriter, req *http.Request) {
				s := d.Auth.sessionFrom(req)
				if s == nil {
					writeJSON(w, map[string]any{"authenticated": false})
					return
				}
				writeJSON(w, map[string]any{"authenticated": true, "user": s.Ident.Name, "groups": s.Ident.Groups})
			})
			r.Get("/logout", d.Auth.HandleLogout)
		})
	}

	r.Group(func(r chi.Router) {
		r.Use(requireToken(token, d.Auth))
		if d.authEnabled() {
			r.Use(d.Auth.Middleware)
		}
		r.Get("/api/clusters", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, d.Clusters.List())
		})
		r.Get("/ws", func(w http.ResponseWriter, req *http.Request) {
			d.Hub.Handle(w, req, poolSource{d.Pools}, wsSubprotocolFromContext(req.Context()))
		})

		r.Get("/api/pf", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, d.PF.List())
		})
		r.Post("/api/pf", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster   string `json:"cluster"`
				Namespace string `json:"namespace"`
				Pod       string `json:"pod"`
				PodPort   int32  `json:"podPort"`
				LocalPort int32  `json:"localPort"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.Pod == "" || body.PodPort == 0 {
				http.Error(w, "cluster, pod, podPort required", http.StatusBadRequest)
				return
			}
			fw, err := d.PF.Start(r.Context(), body.Cluster, body.Namespace, body.Pod, body.PodPort, body.LocalPort)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			d.Audit.Record(audit.Entry{
				Action:    "port-forward",
				Cluster:   body.Cluster,
				Namespace: body.Namespace,
				Resource:  body.Pod,
				Detail:    fmt.Sprintf("podPort=%d localPort=%d", body.PodPort, fw.LocalPort),
				UserAgent: r.Header.Get("User-Agent"),
			})
			writeJSON(w, fw)
		})
		r.Delete("/api/pf/{id}", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			if !d.PF.Stop(id) {
				http.Error(w, "unknown forward", http.StatusNotFound)
				return
			}
			writeJSON(w, map[string]bool{"stopped": true})
		})

		r.Post("/api/action/scale", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster  string `json:"cluster"`
				GVR      string `json:"gvr"`
				NS       string `json:"ns"`
				Name     string `json:"name"`
				Replicas int64  `json:"replicas"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.GVR == "" || body.Name == "" {
				http.Error(w, "cluster, gvr, name required", http.StatusBadRequest)
				return
			}
			if err := d.Actions.Scale(r.Context(), body.Cluster, body.GVR, body.NS, body.Name, body.Replicas); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			d.Audit.Record(audit.Entry{
				Action:    "scale",
				Cluster:   body.Cluster,
				Namespace: body.NS,
				Resource:  body.Name,
				Detail:    fmt.Sprintf("gvr=%s replicas=%d", body.GVR, body.Replicas),
				UserAgent: r.Header.Get("User-Agent"),
			})
			writeJSON(w, map[string]bool{"ok": true})
		})
		r.Post("/api/action/restart", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster string `json:"cluster"`
				GVR     string `json:"gvr"`
				NS      string `json:"ns"`
				Name    string `json:"name"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.GVR == "" || body.Name == "" {
				http.Error(w, "cluster, gvr, name required", http.StatusBadRequest)
				return
			}
			if err := d.Actions.Restart(r.Context(), body.Cluster, body.GVR, body.NS, body.Name); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			d.Audit.Record(audit.Entry{
				Action:    "restart",
				Cluster:   body.Cluster,
				Namespace: body.NS,
				Resource:  body.Name,
				Detail:    fmt.Sprintf("gvr=%s", body.GVR),
				UserAgent: r.Header.Get("User-Agent"),
			})
			writeJSON(w, map[string]bool{"ok": true})
		})
		r.Post("/api/action/delete", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster         string `json:"cluster"`
				GVR             string `json:"gvr"`
				NS              string `json:"ns"`
				Name            string `json:"name"`
				GraceSeconds    *int64 `json:"graceSeconds,omitempty"`
				ForceFinalizers bool   `json:"forceFinalizers,omitempty"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.GVR == "" || body.Name == "" {
				http.Error(w, "cluster, gvr, name required", http.StatusBadRequest)
				return
			}
			if err := d.Actions.Delete(r.Context(), body.Cluster, body.GVR, body.NS, body.Name, body.GraceSeconds, body.ForceFinalizers); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			detail := fmt.Sprintf("gvr=%s forceFinalizers=%t", body.GVR, body.ForceFinalizers)
			if body.GraceSeconds != nil {
				detail += fmt.Sprintf(" gracePeriod=%ds", *body.GraceSeconds)
			}
			d.Audit.Record(audit.Entry{
				Action:    "delete",
				Cluster:   body.Cluster,
				Namespace: body.NS,
				Resource:  body.Name,
				Detail:    detail,
				UserAgent: r.Header.Get("User-Agent"),
			})
			writeJSON(w, map[string]bool{"ok": true})
		})
		r.Post("/api/action/resize-pod", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster   string                 `json:"cluster"`
				NS        string                 `json:"ns"`
				Name      string                 `json:"name"`
				Container string                 `json:"container"`
				Resources map[string]interface{} `json:"resources"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.Name == "" || body.Container == "" {
				http.Error(w, "cluster, ns, name, container required", http.StatusBadRequest)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			defer cancel()
			if err := d.Actions.ResizePod(ctx, body.Cluster, body.NS, body.Name, body.Container, body.Resources); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			writeJSON(w, map[string]bool{"ok": true})
		})

		r.Get("/api/audit", func(w http.ResponseWriter, r *http.Request) {
			entries, err := d.Audit.Tail(500)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if entries == nil {
				entries = []audit.Entry{}
			}
			writeJSON(w, entries)
		})

		r.Get("/api/yaml", d.Channels.HandleGetYAML)
		r.Put("/api/yaml", d.Channels.HandleApplyYAML)
		r.Get("/api/metrics/pods", d.Metrics.HandlePodMetrics)
		r.Get("/api/apis", d.Metrics.HandleDiscovery)
		r.Get("/api/crds", d.Metrics.HandleCRDs)
		r.Get("/api/settings", d.Settings.HandleGet)
		r.Post("/api/settings", d.Settings.HandleSave)
		r.Get("/api/prom/query_range", d.Settings.HandlePromQueryRange)
		r.Get("/api/metrics/nodes", d.Metrics.HandleNodeMetrics)
		r.Get("/api/rbac/all", d.RBAC.HandleAll)
		r.Post("/api/rbac/self", d.RBAC.HandleSelfCheck)

		r.Get("/api/helm/releases", d.Helm.HandleReleases)
		r.Get("/api/helm/repos", d.Helm.HandleRepos)
		r.Post("/api/helm/repos/update", d.Helm.HandleUpdateRepos)
		r.Get("/api/helm/charts", d.Helm.HandleCharts)
		r.Get("/api/helm/chart-values", d.Helm.HandleChartValues)
		r.Get("/api/helm/history", d.Helm.HandleHistory)
		r.Get("/api/helm/values", d.Helm.HandleValues)
		r.Get("/api/helm/manifest", d.Helm.HandleManifest)
		r.Post("/api/action/cordon", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster string `json:"cluster"`
				Node    string `json:"node"`
				Cordon  bool   `json:"cordon"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.Node == "" {
				http.Error(w, "cluster, node required", http.StatusBadRequest)
				return
			}
			if err := d.Actions.Cordon(r.Context(), body.Cluster, body.Node, body.Cordon); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			d.Audit.Record(audit.Entry{
				Action:    "cordon",
				Cluster:   body.Cluster,
				Resource:  body.Node,
				Detail:    fmt.Sprintf("cordon=%t", body.Cordon),
				UserAgent: r.Header.Get("User-Agent"),
			})
			writeJSON(w, map[string]bool{"ok": true})
		})
		r.Post("/api/action/drain", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster          string `json:"cluster"`
				Node             string `json:"node"`
				IgnoreDaemonsets bool   `json:"ignoreDaemonsets"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.Node == "" {
				http.Error(w, "cluster, node required", http.StatusBadRequest)
				return
			}
			if body.IgnoreDaemonsets == false {
				body.IgnoreDaemonsets = true
			}
			sum, err := d.Actions.Drain(r.Context(), body.Cluster, body.Node, body.IgnoreDaemonsets)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			d.Audit.Record(audit.Entry{
				Action:    "drain",
				Cluster:   body.Cluster,
				Resource:  body.Node,
				Detail:    fmt.Sprintf("ignoreDaemonsets=%t evicted=%d", body.IgnoreDaemonsets, len(sum.Evicted)),
				UserAgent: r.Header.Get("User-Agent"),
			})
			writeJSON(w, sum)
		})
		r.Post("/api/action/trigger-cronjob", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster string `json:"cluster"`
				NS      string `json:"ns"`
				Name    string `json:"name"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.NS == "" || body.Name == "" {
				http.Error(w, "cluster, ns, name required", http.StatusBadRequest)
				return
			}
			jobName, err := d.Actions.TriggerCronJob(r.Context(), body.Cluster, body.NS, body.Name)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			writeJSON(w, map[string]string{"job": jobName})
		})
		r.Post("/api/action/suspend-cronjob", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Cluster string `json:"cluster"`
				NS      string `json:"ns"`
				Name    string `json:"name"`
				Suspend bool   `json:"suspend"`
			}
			if err := decodeBody(r, &body); err != nil || body.Cluster == "" || body.NS == "" || body.Name == "" {
				http.Error(w, "cluster, ns, name required", http.StatusBadRequest)
				return
			}
			if err := d.Actions.SetCronSuspend(r.Context(), body.Cluster, body.NS, body.Name, body.Suspend); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			writeJSON(w, map[string]bool{"ok": true})
		})

		r.Post("/api/node-shell", d.NodeShell.HandleStart)

		r.Get("/api/argocd/apps", argoCDAppsHandler(d.Metrics))
		r.Post("/api/argocd/sync", argoCDSyncHandler(d.Metrics))

		r.Post("/api/helm/rollback", d.Helm.HandleRollback)
		r.Post("/api/helm/uninstall", d.Helm.HandleUninstall)
		r.Post("/api/helm/upgrade", d.Helm.HandleUpgrade)
	})

	return r
}

// WSTokenSubprotocolPrefix carries the session token on a WebSocket handshake.
// Browsers cannot set request headers on a WebSocket, and Sec-WebSocket-Protocol
// is the only client-controlled header they do send — unlike a query string it
// stays out of history, referrers, proxy access logs and `ps` output.
const WSTokenSubprotocolPrefix = "kubebay.token."

type wsSubprotocolKey struct{}

// wsSubprotocolFromContext returns the subprotocol requireToken accepted, which
// the server must echo back verbatim or the browser fails the handshake.
func wsSubprotocolFromContext(ctx context.Context) string {
	v, _ := ctx.Value(wsSubprotocolKey{}).(string)
	return v
}

func tokenMatches(got, want string) bool {
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// wsTokenSubprotocol finds an offered subprotocol that carries the right token.
func wsTokenSubprotocol(r *http.Request, token string) (string, bool) {
	for _, header := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, offered := range strings.Split(header, ",") {
			offered = strings.TrimSpace(offered)
			rest, ok := strings.CutPrefix(offered, WSTokenSubprotocolPrefix)
			if ok && tokenMatches(rest, token) {
				return offered, true
			}
		}
	}
	return "", false
}

func requireToken(token string, auth *Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if auth != nil && auth.Enabled() && auth.sessionFrom(r) != nil {
				next.ServeHTTP(w, r)
				return
			}
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}
			if tokenMatches(r.Header.Get("X-Kubebay-Token"), token) {
				next.ServeHTTP(w, r)
				return
			}
			if sub, ok := wsTokenSubprotocol(r, token); ok {
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), wsSubprotocolKey{}, sub)))
				return
			}
			// No ?token= branch: a URL-borne credential leaks into history,
			// referrers and access logs. Header or subprotocol only.
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		})
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

type poolSource struct {
	reg *informers.PoolRegistry
}

func (p poolSource) Subscribe(ctx context.Context, cluster, gvr string, namespaces []string, selector, mode string) (stream.SubHandle, error) {
	pool, err := p.reg.For(ctx, cluster)
	if err != nil {
		return nil, err
	}
	return pool.Subscribe(ctx, gvr, namespaces, selector, mode)
}
