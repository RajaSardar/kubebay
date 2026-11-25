package main

import (
	"crypto/sha256"
	"encoding/base64"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"runtime"
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

// inlineScript matches a <script> with a body, as opposed to one loaded by src.
var inlineScript = regexp.MustCompile(`(?s)<script\b([^>]*)>(.*?)</script>`)

// uiPolicy is the Content-Security-Policy the shell is served under. Everything may load only from
// the engine's own origin, which is also where its WebSocket goes (wss: and ws: are named because
// WebKit doesn't match 'self' to them). The one thing allowed to run inline is each inline <script>
// in the index.html being served, by its SHA-256, so a script injected into the page isn't. No
// eval, no plugins, no <base> or form posting elsewhere. Framing is limited to the engine's own origin
// (frame-src 'self', for the Argo dashboard's same-origin proxy) and nothing may frame the shell.
// Inline styles stay allowed: the shell sets style attributes throughout.
func uiPolicy(index []byte) string {
	script := "'self'"
	for _, m := range inlineScript.FindAllSubmatch(index, -1) {
		if regexp.MustCompile(`\bsrc\s*=`).Match(m[1]) {
			continue
		}
		sum := sha256.Sum256(m[2])
		script += " 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	}
	return strings.Join([]string{
		"default-src 'self'",
		"script-src " + script,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self' ws: wss:",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"frame-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	}, "; ")
}

// hardeningHeaders are set on every response, the API's included.
func hardeningHeaders(h http.Header) {
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
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
		hardeningHeaders(w.Header())
		if isEngineRoute(r.URL.Path) {
			api.ServeHTTP(w, r)
			return
		}
		// Read per request, not once: a rebuilt index.html (--web-dist while developing)
		// brings its own script hashes.
		if index, err := fs.ReadFile(ui, "index.html"); err == nil {
			w.Header().Set("Content-Security-Policy", uiPolicy(index))
		}
		notFoundToIndex.ServeHTTP(w, r)
	})
}

// isEngineRoute names the paths the API router owns; everything else is the UI.
func isEngineRoute(p string) bool {
	return p == "/ws" || p == "/mcp" || p == "/api" || strings.HasPrefix(p, "/api/")
}

func fallbackNotice(api http.Handler) http.Handler {
	page := []byte(`<!doctype html><html><body style="font-family:sans-serif;background:#0a0b10;color:#e9ebf2;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>Kubebay engine is running</h1><p style="color:#9aa2b6">The web UI was not bundled into this binary.<br>Build it with <code>make web</code> or serve <code>--web-dist</code>.</p></div></body></html>`)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hardeningHeaders(w.Header())
		if isEngineRoute(r.URL.Path) {
			api.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(page)
	})
}

func isTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

func tryOpenBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return
	}
	_ = cmd.Start()
}
