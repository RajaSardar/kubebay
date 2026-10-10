package bridge

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type seen struct {
	auth, version, method, name string
	body                        string
}

func fakeEngine(t *testing.T) (*httptest.Server, *[]seen, *sync.Mutex) {
	t.Helper()
	var mu sync.Mutex
	var got []seen
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, seen{r.Header.Get("Authorization"), r.Header.Get("MCP-Protocol-Version"), r.Header.Get("Mcp-Method"), r.Header.Get("Mcp-Name"), string(b)})
		mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer tok-1" && r.Header.Get("Authorization") != "Bearer tok-2" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		_ = json.Unmarshal(b, &req)
		if len(req.ID) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		if req.Method == "slow" {
			time.Sleep(150 * time.Millisecond)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":` + string(req.ID) + `,"result":{"echo":"` + req.Method + `"}}` + "\n"))
	}))
	t.Cleanup(srv.Close)
	return srv, &got, &mu
}

func writeConn(t *testing.T, path, url, token string) {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"url": url, "token": token})
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func runLines(t *testing.T, conn string, lines ...string) []map[string]any {
	t.Helper()
	pr, pw := io.Pipe()
	var out strings.Builder
	var mu sync.Mutex
	done := make(chan error, 1)
	go func() {
		done <- Run(context.Background(), pr, writerFunc(func(p []byte) (int, error) {
			mu.Lock()
			defer mu.Unlock()
			return out.Write(p)
		}), Options{ConnectionFile: conn})
	}()
	for _, l := range lines {
		_, _ = pw.Write([]byte(l + "\n"))
	}
	_ = pw.Close()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
	var res []map[string]any
	sc := bufio.NewScanner(strings.NewReader(out.String()))
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("stdout line is not one JSON message: %q", sc.Text())
		}
		res = append(res, m)
	}
	return res
}

type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }

func TestForwardsModernRequestsWithTheHeadersMirrored(t *testing.T) {
	srv, got, _ := fakeEngine(t)
	conn := filepath.Join(t.TempDir(), "mcp.json")
	writeConn(t, conn, srv.URL+"/mcp", "tok-1")
	out := runLines(t, conn,
		`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"},"name":"list_clusters","arguments":{}}}`,
	)
	if len(out) != 1 || out[0]["result"].(map[string]any)["echo"] != "tools/call" {
		t.Fatalf("out = %v", out)
	}
	s := (*got)[0]
	if s.auth != "Bearer tok-1" || s.version != "2026-07-28" || s.method != "tools/call" || s.name != "list_clusters" {
		t.Errorf("headers = %+v", s)
	}
}

func TestNonASCIIToolNamesAreBase64Encoded(t *testing.T) {
	srv, got, _ := fakeEngine(t)
	conn := filepath.Join(t.TempDir(), "mcp.json")
	writeConn(t, conn, srv.URL+"/mcp", "tok-1")
	runLines(t, conn, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"},"name":"wetter-ä","arguments":{}}}`)
	if n := (*got)[0].name; !strings.HasPrefix(n, "=?base64?") || !strings.HasSuffix(n, "?=") {
		t.Errorf("Mcp-Name = %q", n)
	}
}

func TestNotificationsProduceNoOutput(t *testing.T) {
	srv, got, _ := fakeEngine(t)
	conn := filepath.Join(t.TempDir(), "mcp.json")
	writeConn(t, conn, srv.URL+"/mcp", "tok-1")
	out := runLines(t, conn, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if len(out) != 0 || len(*got) != 1 {
		t.Errorf("out = %v, forwarded = %d", out, len(*got))
	}
}

// An engine that's off, or a token that was revoked, must still answer the
// client: a JSON-RPC error with the request's id, never silence.
func TestEngineRefusalsBecomeJSONRPCErrors(t *testing.T) {
	srv, _, _ := fakeEngine(t)
	conn := filepath.Join(t.TempDir(), "mcp.json")
	writeConn(t, conn, srv.URL+"/mcp", "revoked")
	out := runLines(t, conn, `{"jsonrpc":"2.0","id":"a-1","method":"tools/list","params":{}}`)
	if len(out) != 1 || out[0]["id"] != "a-1" {
		t.Fatalf("out = %v", out)
	}
	msg := out[0]["error"].(map[string]any)["message"].(string)
	if !strings.Contains(msg, "401") || !strings.Contains(msg, "Kubebay") {
		t.Errorf("message = %q", msg)
	}
	missing := filepath.Join(t.TempDir(), "none.json")
	out = runLines(t, missing, `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`)
	if len(out) != 1 || !strings.Contains(out[0]["error"].(map[string]any)["message"].(string), "turn on") {
		t.Errorf("no connection file: %v", out)
	}
}

// The token is read per request, so rotating it in Kubebay doesn't break a
// running assistant.
func TestTheConnectionFileIsReadPerRequest(t *testing.T) {
	srv, got, mu := fakeEngine(t)
	conn := filepath.Join(t.TempDir(), "mcp.json")
	writeConn(t, conn, srv.URL+"/mcp", "tok-1")
	pr, pw := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- Run(context.Background(), pr, io.Discard, Options{ConnectionFile: conn}) }()
	_, _ = pw.Write([]byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}` + "\n"))
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return len(*got) == 1 })
	writeConn(t, conn, srv.URL+"/mcp", "tok-2")
	_, _ = pw.Write([]byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}` + "\n"))
	_ = pw.Close()
	<-done
	if (*got)[1].auth != "Bearer tok-2" {
		t.Errorf("second request used %q", (*got)[1].auth)
	}
}

func TestConcurrentResponsesStayWholeLines(t *testing.T) {
	srv, _, _ := fakeEngine(t)
	conn := filepath.Join(t.TempDir(), "mcp.json")
	writeConn(t, conn, srv.URL+"/mcp", "tok-1")
	var lines []string
	for i := 0; i < 20; i++ {
		m := "fast"
		if i%3 == 0 {
			m = "slow"
		}
		lines = append(lines, `{"jsonrpc":"2.0","id":`+string(rune('0'+i%10))+`,"method":"`+m+`","params":{}}`)
	}
	out := runLines(t, conn, lines...)
	if len(out) != 20 {
		t.Errorf("got %d responses, want 20", len(out))
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition never met")
}

// Something that isn't Kubebay's MCP endpoint (an old build serving its web
// page at /mcp, a proxy's error page) gets a short, readable error, not the
// whole page in the assistant's transcript.
func TestNonMCPAnswersAreShortErrors(t *testing.T) {
	page := "<!doctype html><html>" + strings.Repeat("<div>app</div>", 2000) + "</html>"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(page))
	}))
	t.Cleanup(srv.Close)
	conn := filepath.Join(t.TempDir(), "mcp.json")
	writeConn(t, conn, srv.URL+"/mcp", "tok-1")
	out := runLines(t, conn, `{"jsonrpc":"2.0","id":7,"method":"tools/list","params":{}}`)
	if len(out) != 1 {
		t.Fatalf("out = %v", out)
	}
	msg := out[0]["error"].(map[string]any)["message"].(string)
	if len(msg) > 400 || !strings.Contains(msg, "200") || !strings.Contains(msg, "text/html") || !strings.Contains(msg, "update") {
		t.Errorf("message (%d bytes) = %q", len(msg), msg)
	}
}
