package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/RajaSardar/kubebay/engine/internal/aiinvest"
	"github.com/RajaSardar/kubebay/engine/internal/audit"
)

func TestAIBlockReasonFollowsMCP(t *testing.T) {
	cases := []struct {
		inCluster, oidc, loopback bool
		want                      bool
	}{
		{false, false, true, false},
		{true, false, true, true},
		{false, true, true, true}, // OIDC and an auth proxy
		{false, false, false, true},
	}
	for _, c := range cases {
		got := AIBlockReason(c.inCluster, c.oidc, c.loopback)
		if (got != "") != c.want {
			t.Errorf("%+v -> %q", c, got)
		}
		if c.want && !strings.Contains(got, MCPBlockReason(c.inCluster, c.oidc, c.loopback)) {
			t.Errorf("reason must compose MCPBlockReason so they cannot drift: %q", got)
		}
	}
}

const fakeOK = `#!/bin/sh
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"cause: bad image"}]}}\n'
`

type aiFix struct {
	api   *AIAPI
	h     http.Handler
	audit []audit.Entry
}

func newAIFix(t *testing.T, block string) *aiFix {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "claude")
	_ = os.WriteFile(bin, []byte(fakeOK), 0o755)
	f := &aiFix{}
	mgr := &aiinvest.Manager{
		MCPURL: "http://127.0.0.1:9/mcp", Allowed: []string{"mcp__kubebay__list_clusters"}, TempRoot: t.TempDir(),
		Limits: aiinvest.Limits{Wall: 5 * time.Second, MaxOutput: 4096, Grace: 200 * time.Millisecond},
		Env:    func() []string { return []string{"PATH=/usr/bin:/bin"} },
		Locate: func() string { return bin },
		Audit:  func(e audit.Entry) { f.audit = append(f.audit, e) },
		Mint:   func(string, string, time.Duration) (string, func(), error) { return "tok", func() {}, nil },
	}
	f.api = &AIAPI{Manager: mgr, PrefsPath: filepath.Join(t.TempDir(), "ai.json"), Disabled: block,
		Audit: func(e audit.Entry) { f.audit = append(f.audit, e) }}
	t.Cleanup(mgr.Shutdown)
	r := chi.NewRouter()
	f.api.Routes(r)
	f.h = r
	return f
}

func (f *aiFix) do(method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "127.0.0.1:7777"
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

func status(t *testing.T, f *aiFix) (string, map[string]any) {
	t.Helper()
	rec := f.do("GET", "/api/ai/status", "", nil)
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	return m["state"].(string), m
}

const startBody = `{"cluster":"kind-dev","namespace":"shop","kind":"pods","name":"web-1","issueId":"i1","title":"CrashLoopBackOff"}`

func TestAINoticeGatesStart(t *testing.T) {
	f := newAIFix(t, "")
	if s, m := status(t, f); s != "notice-needed" || m["notice"] == "" {
		t.Fatalf("state %q", s)
	}
	if rec := f.do("POST", "/api/ai/investigations", startBody, nil); rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("start before the notice: %d", rec.Code)
	}
	if len(f.audit) != 0 {
		t.Fatal("nothing may be audited or started before the notice")
	}
	// A wrong version is not an acceptance.
	if rec := f.do("POST", "/api/ai/notice", `{"version":0}`, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("%d", rec.Code)
	}
	if rec := f.do("POST", "/api/ai/notice", `{"version":`+itoa(aiinvest.NoticeVersion)+`}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if s, _ := status(t, f); s != "ready" {
		t.Fatalf("state %q", s)
	}
	// A bumped notice version asks again.
	_ = os.WriteFile(f.api.PrefsPath, []byte(`{"enabled":true,"noticeVersion":`+itoa(aiinvest.NoticeVersion-1)+`}`), 0o600)
	if s, _ := status(t, f); s != "notice-needed" {
		t.Fatalf("an older acceptance still counts: %q", s)
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func accept(t *testing.T, f *aiFix) {
	t.Helper()
	if rec := f.do("POST", "/api/ai/notice", `{"version":`+itoa(aiinvest.NoticeVersion)+`}`, nil); rec.Code != 200 {
		t.Fatal(rec.Body)
	}
}

func TestAIStartStreamsAndAudits(t *testing.T) {
	f := newAIFix(t, "")
	accept(t, f)
	rec := f.do("POST", "/api/ai/investigations", startBody, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var out struct{ ID string }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	ev := f.do("GET", "/api/ai/investigations/"+out.ID+"/events", "", nil)
	if ct := ev.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("content type %q", ct)
	}
	var kinds []string
	sc := bufio.NewScanner(ev.Body)
	for sc.Scan() {
		if d, ok := strings.CutPrefix(sc.Text(), "data: "); ok {
			var e aiinvest.Event
			_ = json.Unmarshal([]byte(d), &e)
			kinds = append(kinds, e.Kind+":"+e.Text)
		}
	}
	joined := strings.Join(kinds, "|")
	if !strings.Contains(joined, "text:cause: bad image") || !strings.HasSuffix(joined, "end:done") {
		t.Fatalf("events: %v", kinds)
	}
	n := 0
	for _, e := range f.audit {
		if e.Action == "ai-investigation" {
			n++
		}
	}
	if n != 2 {
		t.Fatalf("want start and end entries: %+v", f.audit)
	}
}

func TestAIOffByUserAndNoClaude(t *testing.T) {
	f := newAIFix(t, "")
	accept(t, f)
	if rec := f.do("POST", "/api/ai/settings", `{"enabled":false}`, nil); rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	if s, _ := status(t, f); s != "off-by-user" {
		t.Fatalf("state %q", s)
	}
	if rec := f.do("POST", "/api/ai/investigations", startBody, nil); rec.Code != http.StatusConflict {
		t.Fatalf("start while off: %d", rec.Code)
	}
	f.do("POST", "/api/ai/settings", `{"enabled":true}`, nil)
	f.api.Manager.Locate = func() string { return "" }
	s, m := status(t, f)
	if s != "no-claude" || !strings.Contains(m["installHelp"].(string), "claude") {
		t.Fatalf("state %q %v", s, m)
	}
	if rec := f.do("POST", "/api/ai/investigations", startBody, nil); rec.Code != http.StatusConflict {
		t.Fatalf("start without claude: %d", rec.Code)
	}
}

func TestAISharedEngineIsLocked(t *testing.T) {
	f := newAIFix(t, "AI investigations are off here: shared")
	if s, m := status(t, f); s != "locked" || !strings.Contains(m["reason"].(string), "shared") {
		t.Fatalf("state %q", s)
	}
	for _, c := range []struct{ m, p, b string }{
		{"POST", "/api/ai/investigations", startBody},
		{"POST", "/api/ai/settings", `{"enabled":true}`},
		{"POST", "/api/ai/notice", `{"version":` + itoa(aiinvest.NoticeVersion) + `}`},
		{"GET", "/api/ai/investigations/x/events", ""},
		{"DELETE", "/api/ai/investigations/x", ""},
	} {
		if rec := f.do(c.m, c.p, c.b, nil); rec.Code != http.StatusForbidden {
			t.Errorf("%s %s: %d", c.m, c.p, rec.Code)
		}
	}
	if _, err := os.Stat(f.api.PrefsPath); !os.IsNotExist(err) {
		t.Fatal("a locked engine must not write the per-user file")
	}
}

func TestAIRefusesForeignOriginAndNonJSON(t *testing.T) {
	f := newAIFix(t, "")
	accept(t, f)
	if rec := f.do("POST", "/api/ai/investigations", startBody, map[string]string{"Origin": "http://evil.example"}); rec.Code != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", rec.Code)
	}
	if rec := f.do("GET", "/api/ai/status", "", map[string]string{"Origin": "http://evil.example"}); rec.Code != http.StatusForbidden {
		t.Fatalf("foreign origin on GET: %d", rec.Code)
	}
	if rec := f.do("POST", "/api/ai/investigations", startBody, map[string]string{"Origin": "http://127.0.0.1:7777"}); rec.Code != http.StatusOK {
		t.Fatalf("own origin: %d", rec.Code)
	}
	req := httptest.NewRequest("POST", "/api/ai/investigations", strings.NewReader(startBody))
	req.Host = "127.0.0.1:7777"
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("non-json: %d", rec.Code)
	}
}

func TestAIStopAndOwnership(t *testing.T) {
	f := newAIFix(t, "")
	accept(t, f)
	// A run owned by someone else is not reachable.
	other, err := f.api.Manager.Start("someone-else", aiinvest.Request{Cluster: "c"})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Stop()
	if rec := f.do("DELETE", "/api/ai/investigations/"+other.ID, "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("another user's run: %d", rec.Code)
	}
	if rec := f.do("GET", "/api/ai/investigations/"+other.ID+"/events", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("another user's events: %d", rec.Code)
	}
	if rec := f.do("DELETE", "/api/ai/investigations/nope", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown: %d", rec.Code)
	}
	_ = context.Background
}
