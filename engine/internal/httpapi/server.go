package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

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
	Auth      *Authenticator
}

func (d Deps) authEnabled() bool { return d.Auth != nil && d.Auth.Enabled() }

func NewChannels(mgr *clusters.Manager) *Channels {
	return &Channels{Clusters: mgr}
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
			d.Hub.Handle(w, req, poolSource{d.Pools})
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
			writeJSON(w, map[string]bool{"ok": true})
		})
		r.Post("/api/action/delete", func(w http.ResponseWriter, r *http.Request) {
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
			if err := d.Actions.Delete(r.Context(), body.Cluster, body.GVR, body.NS, body.Name); err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			writeJSON(w, map[string]bool{"ok": true})
		})

		r.Get("/api/yaml", d.Channels.HandleGetYAML)
		r.Put("/api/yaml", d.Channels.HandleApplyYAML)
		r.Get("/api/metrics/pods", d.Metrics.HandlePodMetrics)
		r.Get("/api/apis", d.Metrics.HandleDiscovery)
		r.Get("/api/metrics/nodes", d.Metrics.HandleNodeMetrics)
		r.Get("/api/rbac/all", d.RBAC.HandleAll)
		r.Post("/api/rbac/self", d.RBAC.HandleSelfCheck)

		r.Get("/api/helm/releases", d.Helm.HandleReleases)
		r.Get("/api/helm/history", d.Helm.HandleHistory)
		r.Get("/api/helm/values", d.Helm.HandleValues)
		r.Get("/api/helm/manifest", d.Helm.HandleManifest)
		r.Post("/api/node-shell", d.NodeShell.HandleStart)

		r.Post("/api/helm/rollback", d.Helm.HandleRollback)
		r.Post("/api/helm/uninstall", d.Helm.HandleUninstall)
	})

	return r
}

func requireToken(token string, auth *Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if auth != nil && auth.Enabled() && auth.sessionFrom(r) != nil {
				next.ServeHTTP(w, r)
				return
			}
			if token != "" && r.URL.Query().Get("token") != token {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
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
