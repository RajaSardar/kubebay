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

	"github.com/kubebayapp/kubebay/engine/internal/clusters"
	"github.com/kubebayapp/kubebay/engine/internal/informers"
	"github.com/kubebayapp/kubebay/engine/internal/stream"
)

type Deps struct {
	Log      *slog.Logger
	Clusters *clusters.Manager
	Pools    *informers.PoolRegistry
	Hub      *stream.Hub
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

	r.Group(func(r chi.Router) {
		r.Use(requireToken(token))
		r.Get("/api/clusters", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, d.Clusters.List())
		})
		r.Get("/ws", func(w http.ResponseWriter, req *http.Request) {
			d.Hub.Handle(w, req, poolSource{d.Pools})
		})
	})

	return r
}

func requireToken(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

func (p poolSource) Subscribe(ctx context.Context, cluster, gvr string, namespaces []string, selector string) (stream.SubHandle, error) {
	pool, err := p.reg.For(ctx, cluster)
	if err != nil {
		return nil, err
	}
	return pool.Subscribe(ctx, gvr, namespaces, selector)
}
