package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/rolloutsdash"
)

func TestRolloutsDashBlockReasonTable(t *testing.T) {
	cases := []struct {
		inCluster, shared, loopback bool
		blocked                     bool
	}{
		{false, false, true, false},
		{true, false, true, true},   // in-cluster
		{false, true, true, true},   // OIDC or auth proxy
		{false, false, false, true}, // not loopback
		{true, true, false, true},
	}
	for _, c := range cases {
		got := RolloutsDashBlockReason(c.inCluster, c.shared, c.loopback)
		if (got != "") != c.blocked {
			t.Errorf("%+v -> %q", c, got)
		}
	}
}

// fakeSvc stands in for the process manager; the real one is tested in rolloutsdash.
type fakeSvc struct {
	mu       sync.Mutex
	status   rolloutsdash.Status
	started  []string
	startNS  [][]string
	startErr error
	beats    []string
	released []string
	port     int
	token    string
	conns    int
}

func (f *fakeSvc) Status(string) rolloutsdash.Status {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.status
}
func (f *fakeSvc) Start(_ context.Context, c string, ns []string) (rolloutsdash.Status, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.startErr != nil {
		return rolloutsdash.Status{}, f.startErr
	}
	f.started = append(f.started, c)
	f.startNS = append(f.startNS, ns)
	f.status = rolloutsdash.Status{State: rolloutsdash.StateRunning, URL: "/api/rollouts-dashboard/" + f.token + "/"}
	return f.status, nil
}
func (f *fakeSvc) Heartbeat(c string) bool {
	f.mu.Lock()
	f.beats = append(f.beats, c)
	f.mu.Unlock()
	return true
}
func (f *fakeSvc) Release(c string) { f.mu.Lock(); f.released = append(f.released, c); f.mu.Unlock() }
func (f *fakeSvc) Acquire(tok string) (int, func(), bool) {
	if tok != f.token {
		return 0, nil, false
	}
	f.mu.Lock()
	f.conns++
	f.mu.Unlock()
	return f.port, func() { f.mu.Lock(); f.conns--; f.mu.Unlock() }, true
}

type dashFix struct {
	h     http.Handler
	svc   *fakeSvc
	audit *audit.Logger
	up    *httptest.Server
	seen  chan http.Header
	logs  *bytes.Buffer
}

func newDashFix(t *testing.T, disabled string) *dashFix {
	t.Helper()
	f := &dashFix{seen: make(chan http.Header, 8), logs: &bytes.Buffer{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/rollouts-dashboard/TOKEN/", func(w http.ResponseWriter, r *http.Request) {
		select {
		case f.seen <- r.Header.Clone():
		default:
		}
		w.Header().Set("Set-Cookie", "evil=1")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("X-Frame-Options", "ALLOWALL")
		w.Header().Set("Content-Security-Policy", "default-src *")
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "<html>dash</html>")
	})
	mux.HandleFunc("/api/rollouts-dashboard/TOKEN/sse", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		_, _ = io.WriteString(w, "data: one\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})
	mux.HandleFunc("/api/rollouts-dashboard/TOKEN/redir", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", r.URL.Query().Get("to"))
		w.WriteHeader(http.StatusFound)
	})
	mux.HandleFunc("/api/rollouts-dashboard/TOKEN/ws", func(w http.ResponseWriter, r *http.Request) {
		c, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer c.Close()
		_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = rw.Flush()
		line, _ := bufio.NewReader(c).ReadString('\n')
		_, _ = io.WriteString(c, "echo:"+line)
	})
	f.up = httptest.NewServer(mux)
	t.Cleanup(f.up.Close)
	u, _ := url.Parse(f.up.URL)
	_, port, _ := net.SplitHostPort(u.Host)
	p := 0
	for _, ch := range port {
		p = p*10 + int(ch-'0')
	}
	f.svc = &fakeSvc{token: "TOKEN", port: p, status: rolloutsdash.Status{State: rolloutsdash.StateStopped}}
	f.audit, _ = audit.NewWithOptions(slog.Default(), audit.Options{Dir: t.TempDir()})
	t.Cleanup(func() { _ = f.audit.Close() })
	api := &RolloutsDashAPI{
		Svc:      f.svc,
		Disabled: disabled,
		Known:    func(id string) bool { return id == "dev" },
		Audit:    f.audit,
		Log:      slog.New(slog.NewTextHandler(f.logs, nil)),
	}
	f.h = Router(Deps{RolloutsDash: api}, "secret")
	return f
}

func (f *dashFix) do(method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "127.0.0.1:9898"
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

var authed = map[string]string{"X-Kubebay-Token": "secret", "Content-Type": "application/json"}

func TestDashStatusStartHeartbeatReleaseNeedTheSessionToken(t *testing.T) {
	f := newDashFix(t, "")
	for _, c := range [][2]string{{"GET", "/api/rollouts-dashboard/status?cluster=dev"}, {"POST", "/api/rollouts-dashboard/start"}, {"POST", "/api/rollouts-dashboard/heartbeat"}, {"POST", "/api/rollouts-dashboard/release"}} {
		if rec := f.do(c[0], c[1], `{"cluster":"dev"}`, map[string]string{"Content-Type": "application/json"}); rec.Code != 401 {
			t.Errorf("%v without token: %d", c, rec.Code)
		}
	}
}

func TestDashStartAuditsOnceAndPassesNamespaces(t *testing.T) {
	f := newDashFix(t, "")
	rec := f.do("POST", "/api/rollouts-dashboard/start", `{"cluster":"dev","namespaces":["shop"]}`, authed)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"running"`) || !strings.Contains(rec.Body.String(), "/api/rollouts-dashboard/TOKEN/") {
		t.Fatalf("start: %d %s", rec.Code, rec.Body)
	}
	if len(f.svc.startNS) != 1 || strings.Join(f.svc.startNS[0], ",") != "shop" {
		t.Fatalf("namespaces: %v", f.svc.startNS)
	}
	// Reuse of the running dashboard is not a second start.
	f.do("POST", "/api/rollouts-dashboard/start", `{"cluster":"dev"}`, authed)
	got := auditEntries(t, f.audit, "rollouts-dashboard-start")
	if len(got) != 1 || got[0].Cluster != "dev" || got[0].GVR != "rollouts-dashboard" || strings.Contains(got[0].Detail, "TOKEN") {
		t.Fatalf("audit: %+v", got)
	}
}

func TestDashStartUnknownClusterAndBadBody(t *testing.T) {
	f := newDashFix(t, "")
	if rec := f.do("POST", "/api/rollouts-dashboard/start", `{"cluster":"nope"}`, authed); rec.Code != 404 {
		t.Errorf("unknown cluster: %d", rec.Code)
	}
	if rec := f.do("POST", "/api/rollouts-dashboard/start", `{}`, authed); rec.Code != 400 {
		t.Errorf("no cluster: %d", rec.Code)
	}
	if rec := f.do("POST", "/api/rollouts-dashboard/start", `{"cluster":"dev"}`, map[string]string{"X-Kubebay-Token": "secret", "Content-Type": "text/plain"}); rec.Code != 415 {
		t.Errorf("form post: %d", rec.Code)
	}
	if rec := f.do("POST", "/api/rollouts-dashboard/start", `{"cluster":"dev"}`, map[string]string{"X-Kubebay-Token": "secret", "Content-Type": "application/json", "Origin": "https://evil.example"}); rec.Code != 403 {
		t.Errorf("foreign origin: %d", rec.Code)
	}
	f.svc.startErr = rolloutsdash.ErrCapReached
	if rec := f.do("POST", "/api/rollouts-dashboard/start", `{"cluster":"dev"}`, authed); rec.Code != 429 {
		t.Errorf("cap: %d", rec.Code)
	}
}

func TestDashHeartbeatAndRelease(t *testing.T) {
	f := newDashFix(t, "")
	f.do("POST", "/api/rollouts-dashboard/heartbeat", `{"cluster":"dev"}`, authed)
	f.do("POST", "/api/rollouts-dashboard/release", `{"cluster":"dev"}`, authed)
	if len(f.svc.beats) != 1 || len(f.svc.released) != 1 {
		t.Fatalf("beats %v released %v", f.svc.beats, f.svc.released)
	}
	if n := len(auditEntries(t, f.audit, "")); n != 0 {
		t.Fatalf("heartbeat/release must not be audited, got %d entries", n)
	}
}

func TestDashSharedEngineRefusesEverythingServerSide(t *testing.T) {
	reason := RolloutsDashBlockReason(false, true, true)
	f := newDashFix(t, reason)
	st := f.do("GET", "/api/rollouts-dashboard/status?cluster=dev", "", authed)
	if st.Code != 200 || !strings.Contains(st.Body.String(), `"unavailable"`) || !strings.Contains(st.Body.String(), "reason") {
		t.Fatalf("status when locked: %d %s", st.Code, st.Body)
	}
	for _, p := range []string{"start", "heartbeat", "release"} {
		if rec := f.do("POST", "/api/rollouts-dashboard/"+p, `{"cluster":"dev"}`, authed); rec.Code != 403 {
			t.Errorf("%s when locked: %d", p, rec.Code)
		}
	}
	if len(f.svc.started) != 0 {
		t.Fatal("started a process on a shared engine")
	}
	// The proxy route is not mounted at all: even the right token is a 404.
	if rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/", "", nil); rec.Code != 404 && rec.Code != 401 {
		t.Errorf("proxy when locked: %d", rec.Code)
	}
}

func TestDashProxyNeedsTheRightPathToken(t *testing.T) {
	f := newDashFix(t, "")
	if rec := f.do("GET", "/api/rollouts-dashboard/WRONG/", "", nil); rec.Code != 404 {
		t.Fatalf("wrong token: %d", rec.Code)
	}
	rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/", "", nil) // no Authorization header: an iframe cannot send one
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "dash") {
		t.Fatalf("right token: %d %s", rec.Code, rec.Body)
	}
}

func TestDashProxyHostAndOriginChecks(t *testing.T) {
	f := newDashFix(t, "")
	req := httptest.NewRequest("GET", "/api/rollouts-dashboard/TOKEN/", nil)
	req.Host = "evil.example"
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Errorf("non-loopback Host: %d", rec.Code)
	}
	if rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/", "", map[string]string{"Origin": "https://evil.example"}); rec.Code != 403 {
		t.Errorf("cross-site Origin: %d", rec.Code)
	}
	if rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/", "", map[string]string{"Origin": "null"}); rec.Code != 200 {
		t.Errorf("sandboxed frame Origin null: %d", rec.Code)
	}
	if rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/", "", map[string]string{"Origin": "http://127.0.0.1:9898"}); rec.Code != 200 {
		t.Errorf("same Origin: %d", rec.Code)
	}
}

func TestDashProxyStripsKubebayCredentialsUpstream(t *testing.T) {
	f := newDashFix(t, "")
	f.do("GET", "/api/rollouts-dashboard/TOKEN/", "", map[string]string{
		"Authorization": "Bearer abc", "Cookie": "kb=1", "X-Kubebay-Token": "secret", "X-Kubebay-Anything": "x",
		"Origin": "null", "Referer": "http://127.0.0.1:9898/rollouts", "Accept": "text/html",
	})
	h := <-f.seen
	for _, k := range []string{"Authorization", "Cookie", "X-Kubebay-Token", "X-Kubebay-Anything", "Origin", "Referer", "X-Forwarded-For"} {
		if v := h.Get(k); v != "" {
			t.Errorf("%s reached the upstream: %q", k, v)
		}
	}
	if h.Get("Accept") != "text/html" {
		t.Error("ordinary headers must pass")
	}
}

func TestDashProxyResponseHeaders(t *testing.T) {
	f := newDashFix(t, "")
	rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/", "", map[string]string{"Origin": "null"})
	h := rec.Header()
	if got := h.Values("X-Frame-Options"); len(got) != 1 || got[0] != "SAMEORIGIN" {
		t.Errorf("X-Frame-Options: %v", got)
	}
	csp := h.Get("Content-Security-Policy")
	if len(h.Values("Content-Security-Policy")) != 1 || !strings.Contains(csp, "sandbox allow-scripts allow-forms") || strings.Contains(csp, "allow-same-origin") || !strings.Contains(csp, "frame-ancestors 'self'") {
		t.Errorf("CSP: %q", csp)
	}
	if h.Get("Set-Cookie") != "" {
		t.Error("upstream cookie passed")
	}
	if h.Get("Access-Control-Allow-Origin") != "null" {
		t.Errorf("ACAO: %q (want null, never * or a real origin)", h.Get("Access-Control-Allow-Origin"))
	}
	// Without a sandboxed Origin there is no CORS header at all.
	rec2 := f.do("GET", "/api/rollouts-dashboard/TOKEN/", "", nil)
	if rec2.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("ACAO without Origin: %q", rec2.Header().Get("Access-Control-Allow-Origin"))
	}
	// The ordinary API keeps whatever the shell sets: nothing here loosens it.
	api := f.do("GET", "/api/rollouts-dashboard/status?cluster=dev", "", authed)
	if api.Header().Get("X-Frame-Options") != "" || api.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("API response got proxy headers: %v", api.Header())
	}
}

func TestDashProxyOverridesTheShellsDenyHeader(t *testing.T) {
	f := newDashFix(t, "")
	// spaHandler sets X-Frame-Options: DENY before dispatching to the API.
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
		f.h.ServeHTTP(w, r)
	})
	req := httptest.NewRequest("GET", "/api/rollouts-dashboard/TOKEN/", nil)
	req.Host = "127.0.0.1:9898"
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if got := rec.Header().Values("X-Frame-Options"); len(got) != 1 || got[0] != "SAMEORIGIN" {
		t.Fatalf("X-Frame-Options: %v", got)
	}
	if got := rec.Header().Values("Content-Security-Policy"); len(got) != 1 || !strings.Contains(got[0], "frame-ancestors 'self'") {
		t.Fatalf("CSP: %v", got)
	}
}

func TestDashProxyPreflightFromTheSandboxedFrame(t *testing.T) {
	f := newDashFix(t, "")
	rec := f.do("OPTIONS", "/api/rollouts-dashboard/TOKEN/api/v1/x", "", map[string]string{"Origin": "null", "Access-Control-Request-Method": "POST"})
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != "null" {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}
	if rec := f.do("OPTIONS", "/api/rollouts-dashboard/WRONG/x", "", map[string]string{"Origin": "null"}); rec.Code != 404 {
		t.Fatalf("preflight with a wrong token: %d", rec.Code)
	}
}

func TestDashProxyStreamsSSEAndUpgrades(t *testing.T) {
	f := newDashFix(t, "")
	srv := httptest.NewServer(f.h)
	defer srv.Close()
	// SSE: the first event arrives while the upstream is still holding the stream open.
	resp, err := http.Get(srv.URL + "/api/rollouts-dashboard/TOKEN/sse")
	if err != nil {
		t.Fatal(err)
	}
	line, _ := bufio.NewReader(resp.Body).ReadString('\n')
	if line != "data: one\n" {
		t.Fatalf("sse: %q", line)
	}
	waitConns := func(want int) {
		t.Helper()
		for i := 0; i < 100; i++ {
			f.svc.mu.Lock()
			n := f.svc.conns
			f.svc.mu.Unlock()
			if n == want {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatalf("open connections never reached %d", want)
	}
	waitConns(1) // an open stream counts as a live client
	resp.Body.Close()
	waitConns(0)

	// WebSocket-style upgrade.
	c, err := net.Dial("tcp", strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_, _ = io.WriteString(c, "GET /api/rollouts-dashboard/TOKEN/ws HTTP/1.1\r\nHost: "+strings.TrimPrefix(srv.URL, "http://")+"\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: null\r\n\r\n")
	br := bufio.NewReader(c)
	status, _ := br.ReadString('\n')
	if !strings.Contains(status, "101") {
		t.Fatalf("upgrade: %q", status)
	}
	for {
		l, _ := br.ReadString('\n')
		if l == "\r\n" || l == "" {
			break
		}
	}
	_, _ = io.WriteString(c, "ping\n")
	echo, _ := br.ReadString('\n')
	if echo != "echo:ping\n" {
		t.Fatalf("upgraded stream: %q", echo)
	}
}

func TestDashProxyErrorsNeverLogTheToken(t *testing.T) {
	f := newDashFix(t, "")
	f.up.Close() // the upstream is gone: the proxy fails
	rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/anything", "", nil)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("code %d", rec.Code)
	}
	if strings.Contains(f.logs.String(), "TOKEN") || strings.Contains(rec.Body.String(), "TOKEN") {
		t.Fatalf("token leaked: log=%q body=%q", f.logs.String(), rec.Body)
	}
}

// Every route outside the session-token group is named here. A new unauthenticated
// route has to be added on purpose, with a reason.
func TestUnauthenticatedRoutesArePinned(t *testing.T) {
	f := newDashFix(t, "")
	routes, ok := f.h.(chi.Routes)
	if !ok {
		t.Fatal("router is not a chi.Routes")
	}
	allowed := map[string]string{
		"/api/healthz":                      "liveness probe",
		"/api/auth-mode":                    "UI asks how to sign in before it has a credential",
		"/api/rollouts-dashboard/{token}/*": "iframe cannot send headers; the 256-bit path token is the credential (local engine only)",
	}
	_ = chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		path := strings.NewReplacer("/*", "/x", "{token}", "x", "{id}", "x", "{name}", "x").Replace(route)
		path = regexpBraces(path)
		req := httptest.NewRequest(method, path, nil)
		req.Host = "127.0.0.1:9898"
		rec := httptest.NewRecorder()
		func() {
			defer func() { _ = recover() }()
			f.h.ServeHTTP(rec, req)
		}()
		if rec.Code == http.StatusUnauthorized {
			return nil
		}
		if _, ok := allowed[route]; !ok {
			t.Errorf("%s %s answered %d without a token and is not in the allowlist", method, route, rec.Code)
		}
		return nil
	})
}

var braces = regexp.MustCompile(`\{[^}]*\}`)

func regexpBraces(p string) string { return braces.ReplaceAllString(p, "x") }

func auditEntries(t *testing.T, l *audit.Logger, action string) []audit.Entry {
	t.Helper()
	all, err := l.Query(audit.Filter{}, 100)
	if err != nil {
		t.Fatal(err)
	}
	var out []audit.Entry
	for _, e := range all {
		if action == "" || e.Action == action {
			out = append(out, e)
		}
	}
	return out
}

func TestDashProxyDropsRedirectsLeavingTheProxy(t *testing.T) {
	f := newDashFix(t, "")
	for _, to := range []string{"//evil.example/x", "https://evil.example/", "/\\evil.example/"} {
		rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/redir?to="+url.QueryEscape(to), "", nil)
		if loc := rec.Header().Get("Location"); loc != "" {
			t.Errorf("Location %q passed through for %q", loc, to)
		}
	}
	rec := f.do("GET", "/api/rollouts-dashboard/TOKEN/redir?to="+url.QueryEscape("/api/rollouts-dashboard/TOKEN/x"), "", nil)
	if rec.Header().Get("Location") == "" {
		t.Error("a same-site redirect was dropped")
	}
}
