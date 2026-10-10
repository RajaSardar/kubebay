// Package bridge is `kubebay-engine mcp-stdio`: the stdio side of Kubebay's
// MCP server for clients that only launch local commands (Claude Desktop).
// It forwards each newline-delimited JSON-RPC message from stdin to the
// running app's /mcp endpoint and writes the answer to stdout. It holds no
// state of its own and reads the connection file (URL + token) per message,
// so rotating the token in Kubebay never breaks a connected assistant.
package bridge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type Options struct {
	// ConnectionFile is the JSON file Kubebay writes when MCP is turned on.
	ConnectionFile string
	// Client sends the requests; nil uses a client with a 60s timeout.
	Client *http.Client
	// Log receives diagnostics (stderr in production; stdout is protocol only).
	Log io.Writer
}

type connection struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

type message struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method"`
	Params struct {
		Meta      map[string]json.RawMessage `json:"_meta"`
		Name      string                     `json:"name"`
		RequestID json.RawMessage            `json:"requestId"`
	} `json:"params"`
}

// maxLine bounds one stdin message.
const maxLine = 4 << 20

// Run serves until in reaches EOF, then waits for in-flight requests.
func Run(ctx context.Context, in io.Reader, out io.Writer, opt Options) error {
	client := opt.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	logw := opt.Log
	if logw == nil {
		logw = io.Discard
	}
	var outMu sync.Mutex
	write := func(b []byte) {
		outMu.Lock()
		defer outMu.Unlock()
		b = bytes.TrimRight(b, "\n")
		_, _ = out.Write(append(b, '\n'))
	}

	var wg sync.WaitGroup
	var cancelMu sync.Mutex
	cancels := map[string]context.CancelFunc{}

	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 64<<10), maxLine)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		raw := append([]byte(nil), line...)
		var m message
		if err := json.Unmarshal(raw, &m); err != nil {
			write([]byte(`{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}`))
			continue
		}
		// A cancellation ends the in-flight HTTP request it names.
		if m.Method == "notifications/cancelled" {
			cancelMu.Lock()
			if c, ok := cancels[string(m.Params.RequestID)]; ok {
				c()
			}
			cancelMu.Unlock()
		}
		reqCtx, cancel := context.WithCancel(ctx)
		key := string(m.ID)
		if len(m.ID) > 0 {
			cancelMu.Lock()
			cancels[key] = cancel
			cancelMu.Unlock()
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				cancel()
				if len(m.ID) > 0 {
					cancelMu.Lock()
					delete(cancels, key)
					cancelMu.Unlock()
				}
			}()
			resp, err := forward(reqCtx, client, opt.ConnectionFile, raw, m)
			if err != nil {
				fmt.Fprintf(logw, "kubebay-mcp: %v\n", err)
				if len(m.ID) > 0 {
					write(errorLine(m.ID, err.Error()))
				}
				return
			}
			if len(resp) > 0 {
				write(resp)
			}
		}()
	}
	wg.Wait()
	return sc.Err()
}

func errorLine(id json.RawMessage, msg string) []byte {
	b, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error":   map[string]any{"code": -32603, "message": msg},
	})
	return b
}

// headerValue applies the =?base64?…?= sentinel when a value isn't plain,
// header-safe ASCII (or already looks like the sentinel).
func headerValue(v string) string {
	plain := v != "" && strings.TrimSpace(v) == v && !(strings.HasPrefix(v, "=?base64?") && strings.HasSuffix(v, "?="))
	for i := 0; plain && i < len(v); i++ {
		if v[i] < 0x20 || v[i] > 0x7e {
			plain = false
		}
	}
	if plain {
		return v
	}
	return "=?base64?" + base64.StdEncoding.EncodeToString([]byte(v)) + "?="
}

func forward(ctx context.Context, client *http.Client, connFile string, raw []byte, m message) ([]byte, error) {
	b, err := os.ReadFile(connFile)
	if err != nil {
		return nil, fmt.Errorf("Kubebay's MCP connection file %s isn't there: open Kubebay and turn on MCP in Settings", connFile)
	}
	var c connection
	if err := json.Unmarshal(b, &c); err != nil || c.URL == "" || c.Token == "" {
		return nil, fmt.Errorf("Kubebay's MCP connection file %s is incomplete: turn MCP off and on again in Settings", connFile)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("User-Agent", "kubebay-mcp-stdio")
	// The 2026-07-28 request headers, mirrored from the body. Legacy clients
	// carry no version in _meta and need none.
	var version string
	if v, ok := m.Params.Meta["io.modelcontextprotocol/protocolVersion"]; ok {
		_ = json.Unmarshal(v, &version)
	}
	if version != "" {
		req.Header.Set("MCP-Protocol-Version", version)
		req.Header.Set("Mcp-Method", m.Method)
		if m.Params.Name != "" {
			req.Header.Set("Mcp-Name", headerValue(m.Params.Name))
		}
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("can't reach Kubebay at %s (is the app running?): %v", c.URL, err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, maxLine))
	if err != nil {
		return nil, err
	}
	switch {
	case res.StatusCode == http.StatusAccepted:
		return nil, nil
	case strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") && len(bytes.TrimSpace(body)) > 0:
		// JSON-RPC answers, errors included (400/404 carry one in the body).
		return body, nil
	case res.StatusCode == http.StatusOK:
		// A 200 that isn't JSON is something other than the MCP endpoint,
		// most likely an older Kubebay serving its web page at /mcp.
		return nil, fmt.Errorf("Kubebay answered %d with %s, not MCP: update Kubebay and turn MCP on again (%s)", res.StatusCode, contentType(res), snippet(body))
	default:
		return nil, fmt.Errorf("Kubebay answered %d: %s", res.StatusCode, snippet(body))
	}
}

func contentType(res *http.Response) string {
	if ct := res.Header.Get("Content-Type"); ct != "" {
		return strings.TrimSpace(strings.SplitN(ct, ";", 2)[0])
	}
	return "no content type"
}

// snippet keeps an error body short enough for an assistant's transcript.
func snippet(body []byte) string {
	const max = 160
	s := strings.Join(strings.Fields(string(body)), " ")
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}
