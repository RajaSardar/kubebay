package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

const testToken = "s3cr3t-token"

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ok") })
}

func TestRequireTokenHeader(t *testing.T) {
	srv := httptest.NewServer(requireToken(testToken, nil)(okHandler()))
	defer srv.Close()

	cases := []struct {
		name   string
		header string
		url    string
		want   int
	}{
		{name: "correct token", header: testToken, want: http.StatusOK},
		{name: "wrong token", header: "nope", want: http.StatusUnauthorized},
		{name: "no token", want: http.StatusUnauthorized},
		// A URL-borne credential leaks; the query branch is gone for good.
		{name: "query token", url: "/?token=" + testToken, want: http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, srv.URL+tc.url, nil)
			if err != nil {
				t.Fatal(err)
			}
			if tc.header != "" {
				req.Header.Set("X-Kubebay-Token", tc.header)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tc.want {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tc.want)
			}
		})
	}
}

func TestIsLoopbackListenAddr(t *testing.T) {
	cases := map[string]bool{
		"127.0.0.1:9898": true,
		"localhost:9898": true,
		"[::1]:9898":     true,
		"127.0.0.1":      true,
		"0.0.0.0:8080":   false,
		":8080":          false,
		"10.0.0.7:8080":  false,
	}
	for addr, want := range cases {
		if got := IsLoopbackListenAddr(addr); got != want {
			t.Errorf("IsLoopbackListenAddr(%q) = %v, want %v", addr, got, want)
		}
	}
}

func TestRequireLoopbackHost(t *testing.T) {
	srv := httptest.NewServer(RequireLoopbackHost(okHandler()))
	defer srv.Close()

	cases := map[string]int{
		"127.0.0.1:9898": http.StatusOK,
		"localhost:9898": http.StatusOK,
		"LOCALHOST":      http.StatusOK,
		"[::1]:9898":     http.StatusOK,
		// What a DNS-rebinding attacker's browser must send.
		"evil.example":      http.StatusForbidden,
		"evil.example:9898": http.StatusForbidden,
	}
	for host, want := range cases {
		req, err := http.NewRequest(http.MethodGet, srv.URL, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Host = host
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("Host %q: status = %d, want %d", host, resp.StatusCode, want)
		}
	}
}

// wsServer wires the real Hub behind the real auth middleware so the test
// covers the whole handshake: the middleware must accept the token-bearing
// subprotocol AND the Hub must echo it, or a browser refuses the connection.
func wsServer(t *testing.T) *httptest.Server {
	t.Helper()
	hub := stream.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Handle(w, r, nil, wsSubprotocolFromContext(r.Context()))
	})
	srv := httptest.NewServer(requireToken(testToken, nil)(h))
	t.Cleanup(srv.Close)
	return srv
}

func dialWS(t *testing.T, srv *httptest.Server, subprotocols []string, origin string) (*websocket.Conn, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	header := http.Header{}
	if origin != "" {
		header.Set("Origin", origin)
	}
	c, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", &websocket.DialOptions{
		Subprotocols: subprotocols,
		HTTPHeader:   header,
	})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	return c, err
}

func TestWebSocketTokenSubprotocol(t *testing.T) {
	srv := wsServer(t)

	want := WSTokenSubprotocolPrefix + testToken
	c, err := dialWS(t, srv, []string{want}, "")
	if err != nil {
		t.Fatalf("dial with valid token subprotocol: %v", err)
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	if got := c.Subprotocol(); got != want {
		t.Fatalf("negotiated subprotocol = %q, want %q", got, want)
	}
}

func TestWebSocketRejectsBadSubprotocol(t *testing.T) {
	srv := wsServer(t)

	for _, sub := range [][]string{
		nil,
		{WSTokenSubprotocolPrefix + "wrong"},
		{"kubebay.token"},
		{testToken},
	} {
		c, err := dialWS(t, srv, sub, "")
		if err == nil {
			_ = c.Close(websocket.StatusNormalClosure, "")
			t.Fatalf("dial with subprotocols %v succeeded, want rejection", sub)
		}
	}
}

func TestWebSocketOrigins(t *testing.T) {
	srv := wsServer(t)
	sub := []string{WSTokenSubprotocolPrefix + testToken}

	// Kubebay's own Vite dev server is the only cross-origin caller allowed.
	c, err := dialWS(t, srv, sub, "http://localhost:5173")
	if err != nil {
		t.Fatalf("dial from the dev server origin: %v", err)
	}
	_ = c.Close(websocket.StatusNormalClosure, "")

	for _, origin := range []string{"http://evil.example", "http://localhost:8888", "http://127.0.0.1:8888"} {
		c, err := dialWS(t, srv, sub, origin)
		if err == nil {
			_ = c.Close(websocket.StatusNormalClosure, "")
			t.Errorf("dial from origin %q succeeded, want rejection", origin)
		}
	}
}
