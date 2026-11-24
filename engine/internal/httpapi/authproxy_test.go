package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/authproxy"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// Backlog 81: identity from an authenticating reverse proxy. The shared
// engine must give each person exactly what their own RBAC gives them, and
// must never fall through to an anonymous or launch-token caller.

const (
	proxyPeer     = "10.1.2.7:41000"
	untrustedPeer = "192.0.2.50:41000"
)

func proxyVerifier(t *testing.T) *authproxy.Verifier {
	t.Helper()
	cidrs, err := authproxy.ParseCIDRs("10.1.2.0/24")
	if err != nil {
		t.Fatal(err)
	}
	v, err := authproxy.New(authproxy.Config{UserHeader: "X-Auth-Request-User", GroupsHeader: "X-Auth-Request-Groups", TrustedCIDRs: cidrs})
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func proxyReq(method, path, peer, user string) *http.Request {
	r := httptest.NewRequest(method, path, nil)
	r.RemoteAddr = peer
	if user != "" {
		r.Header.Set("X-Auth-Request-User", user)
	}
	return r
}

func serve(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func proxyRouter(t *testing.T, d Deps, token string) http.Handler {
	d.Proxy = proxyVerifier(t)
	d.Log = quietLog()
	return Router(d, token)
}

func wasteBody(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var rows []struct{ Ns string }
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, r := range rows {
		out = append(out, r.Ns)
	}
	slices.Sort(out)
	return out
}

func TestProxyUserCannotReadAnotherNamespaceThroughTheSharedEngine(t *testing.T) {
	api := newSSARServer(t, map[string][]string{"alice": {"shop"}, "bob": {"*"}})
	h := proxyRouter(t, Deps{Clusters: managerFor(t, api.URL), Waste: everyNamespace}, "launch")
	path := "/api/waste/workloads?cluster=dev"

	if got := wasteBody(t, serve(h, proxyReq("GET", path, proxyPeer, "alice"))); !slices.Equal(got, []string{"shop"}) {
		t.Errorf("alice sees %v, want only shop", got)
	}
	if got := wasteBody(t, serve(h, proxyReq("GET", path, proxyPeer, "bob"))); !slices.Equal(got, []string{"kube-system", "payments", "shop"}) {
		t.Errorf("bob sees %v, want every namespace", got)
	}
	if got := wasteBody(t, serve(h, proxyReq("GET", path, proxyPeer, "mallory"))); len(got) != 0 {
		t.Errorf("a user RBAC does not know sees %v", got)
	}
	api.mu.Lock()
	reviews := slices.Clone(api.reviews)
	api.mu.Unlock()
	for _, want := range []string{"alice:", "bob:", "mallory:"} {
		if !slices.ContainsFunc(reviews, func(s string) bool { return strings.HasPrefix(s, want) }) {
			t.Errorf("no access review was made as %s: %v", want, reviews)
		}
	}
}

func TestClientImpersonationHeadersAreIgnored(t *testing.T) {
	api := newSSARServer(t, map[string][]string{"alice": {"shop"}, "root": {"*"}})
	h := proxyRouter(t, Deps{Clusters: managerFor(t, api.URL), Waste: everyNamespace}, "")
	r := proxyReq("GET", "/api/waste/workloads?cluster=dev", proxyPeer, "alice")
	r.Header.Set("Impersonate-User", "root")
	r.Header.Add("Impersonate-Group", "system:masters")
	if got := wasteBody(t, serve(h, r)); !slices.Equal(got, []string{"shop"}) {
		t.Errorf("alice sees %v with a forged Impersonate-User", got)
	}
}

func TestUntrustedPeerGets401OnEveryAPIRouteEvenWithSpoofedHeaders(t *testing.T) {
	api := newSSARServer(t, map[string][]string{"admin": {"*"}})
	h := proxyRouter(t, Deps{Clusters: managerFor(t, api.URL), Waste: everyNamespace}, "")
	for _, path := range []string{"/api/waste/workloads?cluster=dev", "/api/version", "/api/clusters", "/api/auth/me", "/ws", "/api/auth/login"} {
		r := proxyReq("GET", path, untrustedPeer, "admin")
		r.Header.Set("X-Forwarded-For", "10.1.2.7")
		if rec := serve(h, r); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s from an untrusted peer: %d", path, rec.Code)
		}
	}
	if api.count() != 0 {
		t.Errorf("the API server was asked %d times on behalf of an untrusted peer", api.count())
	}
}

func TestTrustedPeerWithoutAUserHeaderGets401NotAnonymous(t *testing.T) {
	api := newSSARServer(t, nil)
	h := proxyRouter(t, Deps{Clusters: managerFor(t, api.URL), Waste: everyNamespace}, "")
	if rec := serve(h, proxyReq("GET", "/api/waste/workloads?cluster=dev", proxyPeer, "")); rec.Code != http.StatusUnauthorized {
		t.Errorf("no header: %d", rec.Code)
	}
	r := proxyReq("GET", "/api/waste/workloads?cluster=dev", proxyPeer, "al\nice")
	r.Header["X-Auth-Request-User"] = []string{"alice\r\nX-Evil: 1"}
	if rec := serve(h, r); rec.Code != http.StatusUnauthorized {
		t.Errorf("CRLF header: %d", rec.Code)
	}
}

func TestLaunchTokenIsNotACredentialInProxyMode(t *testing.T) {
	api := newSSARServer(t, nil)
	h := proxyRouter(t, Deps{Clusters: managerFor(t, api.URL), Waste: everyNamespace}, "launch")
	for name, peer := range map[string]string{"untrusted": untrustedPeer, "trusted, no user header": proxyPeer} {
		r := proxyReq("GET", "/api/waste/workloads?cluster=dev", peer, "")
		r.Header.Set("X-Kubebay-Token", "launch")
		if rec := serve(h, r); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s with the launch token: %d", name, rec.Code)
		}
	}
	r := proxyReq("GET", "/api/waste/workloads?cluster=dev", untrustedPeer, "")
	r.Header.Set("Sec-WebSocket-Protocol", WSTokenSubprotocolPrefix+"launch")
	if rec := serve(h, r); rec.Code != http.StatusUnauthorized {
		t.Errorf("websocket token subprotocol: %d", rec.Code)
	}
}

func TestProbesAndAuthModeStayPublic(t *testing.T) {
	h := proxyRouter(t, Deps{}, "launch")
	if rec := serve(h, proxyReq("GET", "/api/healthz", "203.0.113.9:1", "")); rec.Code != http.StatusOK {
		t.Errorf("healthz from a node IP: %d", rec.Code)
	}
	rec := serve(h, proxyReq("GET", "/api/auth-mode", "203.0.113.9:1", ""))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"proxy"`) {
		t.Errorf("auth-mode: %d %s", rec.Code, rec.Body)
	}
}

func TestAuthMeReportsTheProxyIdentityAndThereIsNoLogin(t *testing.T) {
	h := proxyRouter(t, Deps{}, "")
	r := proxyReq("GET", "/api/auth/me", proxyPeer, "alice@example.com")
	r.Header.Set("X-Auth-Request-Groups", "dev, ops")
	rec := serve(h, r)
	var me struct {
		Authenticated bool
		User          string
		Groups        []string
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &me)
	if rec.Code != 200 || !me.Authenticated || me.User != "alice@example.com" || !slices.Equal(me.Groups, []string{"dev", "ops"}) {
		t.Errorf("me: %d %s", rec.Code, rec.Body)
	}
	for _, p := range []string{"/api/auth/login", "/api/auth/logout", "/api/auth/callback"} {
		if rec := serve(h, proxyReq("GET", p, proxyPeer, "alice")); rec.Code == http.StatusFound || rec.Code == http.StatusOK {
			t.Errorf("%s is served in proxy mode: %d", p, rec.Code)
		}
	}
}

func TestSharedClusterActionsAreForbiddenInProxyMode(t *testing.T) {
	sm := settingsWithManager(t)
	h := proxyRouter(t, Deps{Clusters: sm.mgr}, "")
	if rec := serve(h, proxyReq("POST", "/api/clusters/kind-dev/disconnect", proxyPeer, "alice")); rec.Code != http.StatusForbidden {
		t.Errorf("disconnect: %d", rec.Code)
	}
	r := proxyReq("PUT", "/api/clusters/protected", proxyPeer, "alice")
	r.Body = io.NopCloser(strings.NewReader(`{"ids":[]}`))
	if rec := serve(h, r); rec.Code != http.StatusForbidden {
		t.Errorf("protect: %d", rec.Code)
	}
}

func TestProxyGateCarriesIdentityOnWebSocketUpgrades(t *testing.T) {
	var got *clusters.Identity
	h := ProxyGate(proxyVerifier(t), quietLog())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = IdentityFromContext(r.Context())
		if r.Header.Get("X-Auth-Request-User") != "" {
			t.Error("identity header reached the handler")
		}
	}))
	r := proxyReq("GET", "/ws", proxyPeer, "alice")
	r.Header.Set("Connection", "Upgrade")
	r.Header.Set("Upgrade", "websocket")
	r.Header.Set("X-Auth-Request-Groups", "dev")
	serve(h, r)
	if got == nil || got.Name != "alice" || !slices.Equal(got.Groups, []string{"dev"}) {
		t.Errorf("stream handler saw %+v", got)
	}
}

func TestProxyGateSkipsARequestThatAlreadyHasAnIdentity(t *testing.T) {
	called := 0
	h := ProxyGate(proxyVerifier(t), quietLog())(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called++ }))
	// Outer gate scrubbed the headers; the inner gate must not 401 it.
	r := proxyReq("GET", "/api/version", proxyPeer, "alice")
	outer := ProxyGate(proxyVerifier(t), quietLog())(h)
	if rec := serve(outer, r); rec.Code != 200 || called != 1 {
		t.Errorf("nested gates: %d, called %d", rec.Code, called)
	}
}

// Every helper that takes the "shared identity" boolean must lock when it is
// true; main passes it for OIDC and auth-proxy alike.
func TestEveryBlockReasonLocksWhenIdentityIsShared(t *testing.T) {
	reasons := map[string]string{
		"settings":   SharedSettingsBlockReason(false, true),
		"helm repos": SharedHelmReposBlockReason(false, true),
		"audit feed": AuditFeedBlockReason(false, true),
		"warm":       WarmPolicyBlockReason(false, true),
		"history":    HistoryBlockReason(false, true),
		"mcp":        MCPBlockReason(false, true, true),
		"triage":     TriageBlockReason(false, true),
		"extensions": ExtensionsBlockReason(false, true),
		"discovery":  DiscoveryBlockReason(false, true),
	}
	for name, r := range reasons {
		if r == "" {
			t.Errorf("%s stays open on a shared-identity engine", name)
		}
		if !strings.Contains(r, "auth proxy") {
			t.Errorf("%s reason does not mention the auth proxy: %q", name, r)
		}
	}
}

// The proxy attaches the user's identity to every request their browser makes,
// including one an attacker's page triggers. The browser's own Sec-Fetch-Site
// header tells a cross-site request apart, whatever Host the proxy forwards.
func TestProxyGateRefusesCrossSiteMutationsAndUpgrades(t *testing.T) {
	var reached bool
	h := ProxyGate(proxyVerifier(t), quietLog())(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { reached = true }))
	cases := []struct {
		method, site, upgrade string
		want                  int
	}{
		{"POST", "cross-site", "", 403},
		{"DELETE", "same-site", "", 403},
		{"PUT", "cross-site", "", 403},
		{"GET", "cross-site", "websocket", 403},
		{"POST", "same-origin", "", 200},
		{"POST", "", "", 200},
		{"POST", "none", "", 200},
		{"GET", "cross-site", "", 200}, // a plain read is not a mutation
		{"GET", "same-origin", "websocket", 200},
	}
	for _, c := range cases {
		reached = false
		r := proxyReq(c.method, "/api/clusters", proxyPeer, "alice")
		if c.site != "" {
			r.Header.Set("Sec-Fetch-Site", c.site)
		}
		if c.upgrade != "" {
			r.Header.Set("Upgrade", c.upgrade)
		}
		rec := serve(h, r)
		if rec.Code != c.want || reached != (c.want == 200) {
			t.Errorf("%s site=%q upgrade=%q: got %d reached=%v, want %d", c.method, c.site, c.upgrade, rec.Code, reached, c.want)
		}
	}
	// An untrusted peer is still a 401, not a 403 that hints it was recognised.
	r := proxyReq("POST", "/api/clusters", untrustedPeer, "alice")
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	if rec := serve(h, r); rec.Code != 401 {
		t.Errorf("untrusted cross-site: %d", rec.Code)
	}
}
