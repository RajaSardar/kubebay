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
		want   int
	}{
		{"correct token", testToken, http.StatusOK},
		{"wrong token", "nope", http.StatusUnauthorized},
		{"no token", "", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, srv.URL, nil)
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

func dialWS(t *testing.T, srv *httptest.Server, subprotocols []string) (*websocket.Conn, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", &websocket.DialOptions{
		Subprotocols: subprotocols,
	})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	return c, err
}

func TestWebSocketTokenSubprotocol(t *testing.T) {
	srv := wsServer(t)

	want := WSTokenSubprotocolPrefix + testToken
	c, err := dialWS(t, srv, []string{want})
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
		c, err := dialWS(t, srv, sub)
		if err == nil {
			_ = c.Close(websocket.StatusNormalClosure, "")
			t.Fatalf("dial with subprotocols %v succeeded, want rejection", sub)
		}
	}
}
