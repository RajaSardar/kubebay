package httpapi

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// identitySource is what the auth-proxy mode needs from authproxy.Verifier.
type identitySource interface {
	Enabled() bool
	Identify(*http.Request) (*clusters.Identity, error)
	Scrub(http.Header)
}

// ProxyGate refuses every request whose direct peer and headers do not
// identify a user, and stores the identity in the request context the way the
// OIDC middleware does. Only the kubelet probe and the UI's mode probe stay
// open. There is no anonymous fallthrough and the launch token is not a
// credential here. A request that already carries an identity (an outer gate
// ran) passes, because the outer gate scrubbed the headers it read.
func ProxyGate(src identitySource, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if IdentityFromContext(r.Context()) != nil || r.URL.Path == "/api/healthz" || r.URL.Path == "/api/auth-mode" {
				next.ServeHTTP(w, r)
				return
			}
			ident, err := src.Identify(r)
			if err != nil {
				if log != nil {
					// Peer and reason only; never header values or the secret.
					log.Warn("auth proxy refused a request", "peer", r.RemoteAddr, "path", r.URL.Path, "reason", err.Error())
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"the auth proxy did not authenticate this request","proxy":true}`))
				return
			}
			if crossSiteMutation(r) {
				// The proxy adds this user's identity to whatever their browser
				// sends, so a page on another site could act as them. The
				// browser says where the request came from.
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":"cross-site request refused"}`))
				return
			}
			r = r.WithContext(WithIdentity(r.Context(), ident))
			src.Scrub(r.Header)
			next.ServeHTTP(w, r)
		})
	}
}

// HandleMeFromContext answers /api/auth/me from the identity in context.
func HandleMeFromContext(w http.ResponseWriter, r *http.Request) {
	ident := IdentityFromContext(r.Context())
	if ident == nil {
		writeJSON(w, map[string]any{"authenticated": false})
		return
	}
	writeJSON(w, map[string]any{"authenticated": true, "user": ident.Name, "groups": ident.Groups})
}

// crossSiteMutation reports a state-changing request, or a WebSocket upgrade,
// the browser marked as coming from another origin or site. Requests without
// the header (scripts, older browsers) pass; plain reads always pass.
func crossSiteMutation(r *http.Request) bool {
	switch r.Header.Get("Sec-Fetch-Site") {
	case "", "same-origin", "none":
		return false
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
	}
	return true
}
