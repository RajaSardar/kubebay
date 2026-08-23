package main

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
)

func embeddedUI() (fs.FS, bool) {
	sub, err := fs.Sub(httpapi.StaticFS, "static/dist")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, false
	}
	return sub, true
}

func diskUI(dir string) (fs.FS, bool) {
	sub := osDirFS(dir)
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, false
	}
	return sub, true
}

func spaHandler(ui fs.FS, api http.Handler) http.Handler {
	files := http.FileServerFS(ui)
	notFoundToIndex := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(ui, path); err != nil {
			r.URL.Path = "/"
			files.ServeHTTP(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ws" || strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			api.ServeHTTP(w, r)
			return
		}
		notFoundToIndex.ServeHTTP(w, r)
	})
}

func fallbackNotice(api http.Handler) http.Handler {
	page := []byte(`<!doctype html><html><body style="font-family:sans-serif;background:#0a0b10;color:#e9ebf2;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>Kubebay engine is running</h1><p style="color:#9aa2b6">The web UI was not bundled into this binary.<br>Build it with <code>make web</code> or serve <code>--web-dist</code>.</p></div></body></html>`)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ws" || strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			api.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(page)
	})
}
