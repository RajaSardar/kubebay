package main

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// Engine routes outside /api/ must still reach the API router: the MCP
// endpoint (/mcp) returned the SPA's index.html in the shipped binary.
func TestSPAAndFallbackSendEngineRoutesToTheAPI(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-From", "api")
	})
	ui := fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}}
	for name, h := range map[string]http.Handler{"spa": spaHandler(ui, api), "fallback": fallbackNotice(api)} {
		for _, tc := range []struct {
			method, path string
			api          bool
		}{
			{http.MethodPost, "/mcp", true},
			{http.MethodGet, "/ws", true},
			{http.MethodGet, "/api/clusters", true},
			{http.MethodGet, "/", false},
			{http.MethodGet, "/mcp-guide", false},
			{http.MethodGet, "/pods", false},
		} {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
			if got := rec.Header().Get("X-From") == "api"; got != tc.api {
				t.Errorf("%s %s %s: reached API = %v, want %v", name, tc.method, tc.path, got, tc.api)
			}
		}
	}
}

const bootScript = `
      (function () { document.documentElement.setAttribute("data-theme", "dawn"); })();
    `

var indexWithInlineScript = []byte(`<!doctype html><html><head><script id="kb-theme-boot">` + bootScript + `</script>` +
	`<script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>`)

func directives(csp string) map[string][]string {
	out := map[string][]string{}
	for _, part := range strings.Split(csp, ";") {
		f := strings.Fields(part)
		if len(f) > 0 {
			out[f[0]] = f[1:]
		}
	}
	return out
}

func has(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// The shell is served by the engine to a webview and to a browser. A content
// security policy keeps a stray bit of injected markup from running as script, and
// so from calling the engine's API with the page's token. The page has one inline
// script (the theme boot), allowed by its exact hash, and nothing may run from
// anywhere but the engine's own origin.
func TestUIIsServedWithAContentSecurityPolicy(t *testing.T) {
	ui := fstest.MapFS{"index.html": {Data: indexWithInlineScript}, "assets/index.js": {Data: []byte("export {}")}}
	h := spaHandler(ui, http.NotFoundHandler())
	sum := sha256.Sum256([]byte(bootScript))
	hash := "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"

	for _, path := range []string{"/", "/pods", "/clusters/prod/pods"} { // a deep link falls back to index.html
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		csp := rec.Header().Get("Content-Security-Policy")
		if csp == "" {
			t.Fatalf("%s: no Content-Security-Policy", path)
		}
		d := directives(csp)
		for _, c := range []struct {
			dir  string
			want string
		}{
			{"default-src", "'self'"},
			{"script-src", "'self'"},
			{"script-src", hash},
			{"connect-src", "'self'"},
			{"connect-src", "ws:"},
			{"connect-src", "wss:"}, // the WebSocket, which WebKit doesn't match to 'self'
			{"worker-src", "blob:"}, // the code editor's workers
			{"img-src", "data:"},
			{"object-src", "'none'"},
			{"frame-ancestors", "'none'"},
			{"base-uri", "'self'"},
			{"form-action", "'self'"},
		} {
			if !has(d[c.dir], c.want) {
				t.Errorf("%s: %s lacks %s: %v", path, c.dir, c.want, d[c.dir])
			}
		}
		for _, bad := range []string{"'unsafe-inline'", "'unsafe-eval'", "*", "http:", "https:", "data:"} {
			if has(d["script-src"], bad) {
				t.Errorf("%s: script-src allows %s: %v", path, bad, d["script-src"])
			}
		}
	}
}

func TestAChangedInlineScriptIsNotAllowedByTheOldHash(t *testing.T) {
	// The hash is taken from the index the engine serves, so editing that script (a
	// theme change) updates the policy, and a different script is not covered.
	other := []byte(`<!doctype html><script>alert(1)</script>`)
	h := spaHandler(fstest.MapFS{"index.html": {Data: other}}, http.NotFoundHandler())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	sum := sha256.Sum256([]byte(bootScript))
	if strings.Contains(rec.Header().Get("Content-Security-Policy"), base64.StdEncoding.EncodeToString(sum[:])) {
		t.Error("the policy still allows a script that is no longer on the page")
	}
}

func TestEveryResponseCarriesTheBasicHardeningHeaders(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("{}")) })
	ui := fstest.MapFS{"index.html": {Data: indexWithInlineScript}, "assets/index.js": {Data: []byte("export {}")}}
	h := spaHandler(ui, api)
	for _, path := range []string{"/", "/assets/index.js", "/api/clusters"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		for k, want := range map[string]string{
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy":        "no-referrer",
			"X-Frame-Options":        "DENY",
		} {
			if got := rec.Header().Get(k); got != want {
				t.Errorf("%s: %s = %q, want %q", path, k, got, want)
			}
		}
	}
}

func TestTheFallbackNoticeAllowsNoScriptAtAll(t *testing.T) {
	rec := httptest.NewRecorder()
	fallbackNotice(http.NotFoundHandler()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	d := directives(rec.Header().Get("Content-Security-Policy"))
	if !has(d["default-src"], "'none'") {
		t.Errorf("the notice page's default-src = %v, want 'none'", d["default-src"])
	}
}
