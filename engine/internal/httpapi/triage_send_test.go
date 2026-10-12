package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeMessages stands in for the Messages API (or a proxy on this machine)
// and records what it was sent.
type fakeMessages struct {
	srv    *httptest.Server
	bodies []string
	keys   []string
	status int
}

func newFakeMessages(t *testing.T) *fakeMessages {
	t.Helper()
	m := &fakeMessages{status: http.StatusOK}
	m.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		m.bodies = append(m.bodies, string(b))
		m.keys = append(m.keys, r.Header.Get("X-Api-Key"))
		w.Header().Set("Content-Type", "application/json")
		if m.status != http.StatusOK {
			w.WriteHeader(m.status)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
			return
		}
		answer, _ := json.Marshal(`{"summary":"a nil map write panics at start","findings":[{"title":"nil map panic","likelihood":"likely","explanation":"see the previous run","evidence":["E2"],"nextSteps":["check the config"]},{"title":"guess","likelihood":"unlikely","explanation":"none","evidence":["E9"],"nextSteps":[]}],"missingEvidence":""}`)
		_, _ = io.WriteString(w, `{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[{"type":"text","text":`+string(answer)+`}],"stop_reason":"end_turn","usage":{"input_tokens":900,"output_tokens":120}}`)
	}))
	t.Cleanup(m.srv.Close)
	return m
}

// sendFixture is triage on for kind-dev, pointed at a fake API, with a
// preview taken.
func sendFixture(t *testing.T) (*triageFixture, *fakeMessages, string) {
	t.Helper()
	f := newTriageFixture(t)
	m := newFakeMessages(t)
	if rec := f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":true,"clusters":["kind-dev"],"baseURL":"`+m.srv.URL+`"}`); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	f.keys.stored["kubebay-triage/api-key"] = "sk-ant-secret-value-1234567890"
	rec := f.do(t, f.api.HandlePreview, http.MethodPost, `{"cluster":"kind-dev","namespace":"shop","pod":"api-7d9-x"}`)
	var p struct {
		PreviewID string          `json:"previewId"`
		Request   json.RawMessage `json:"request"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil || p.PreviewID == "" {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body)
	}
	f.previewed = p.Request
	return f, m, p.PreviewID
}

func (f *triageFixture) send(t *testing.T, id string) *httptest.ResponseRecorder {
	t.Helper()
	return f.do(t, f.api.HandleSend, http.MethodPost, `{"previewId":"`+id+`"}`)
}

func TestSendMakesExactlyTheReviewedCall(t *testing.T) {
	f, m, id := sendFixture(t)
	rec := f.send(t, id)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "sk-ant-secret") {
		t.Fatal("the key is never in a response")
	}
	if len(m.bodies) != 1 || m.keys[0] != "sk-ant-secret-value-1234567890" {
		t.Fatalf("sent %d calls, keys %v", len(m.bodies), m.keys)
	}
	// The preview showed the body; the wire carried the same one.
	var sent, shown map[string]any
	_ = json.Unmarshal([]byte(m.bodies[0]), &sent)
	_ = json.Unmarshal(f.previewed, &shown)
	sb, _ := json.Marshal(sent)
	pb, _ := json.Marshal(shown)
	if string(sb) != string(pb) {
		t.Errorf("sent body differs from the preview:\nsent  %s\nshown %s", sb, pb)
	}
	var res struct {
		Summary  string `json:"summary"`
		Dropped  int    `json:"dropped"`
		Findings []struct {
			Title    string   `json:"title"`
			Evidence []string `json:"evidence"`
		} `json:"findings"`
		InputTokens int `json:"inputTokens"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Summary == "" || len(res.Findings) != 1 || res.Findings[0].Evidence[0] != "E2" || res.Dropped != 1 || res.InputTokens != 900 {
		t.Errorf("result = %s", rec.Body)
	}
	last := f.entries[len(f.entries)-1]
	if last.Action != "triage:send" || last.Cluster != "kind-dev" || last.Resource != "api-7d9-x" || !strings.Contains(last.Detail, "findings=1") || !strings.Contains(last.Detail, "dropped=1") {
		t.Errorf("audit = %+v", last)
	}
	if rec := f.send(t, id); rec.Code != http.StatusNotFound {
		t.Errorf("a preview sends once: %d %s", rec.Code, rec.Body)
	}
}

func TestSendNeedsAKey(t *testing.T) {
	f, m, id := sendFixture(t)
	delete(f.keys.stored, "kubebay-triage/api-key")
	if rec := f.send(t, id); rec.Code != http.StatusPreconditionFailed || !strings.Contains(rec.Body.String(), "key") {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
	if len(m.bodies) != 0 {
		t.Error("nothing is sent without a key")
	}
}

func TestSendRechecksTheGates(t *testing.T) {
	f, m, id := sendFixture(t)
	f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":true,"clusters":["other"],"baseURL":"`+m.srv.URL+`"}`)
	if rec := f.send(t, id); rec.Code != http.StatusForbidden {
		t.Errorf("cluster removed: %d %s", rec.Code, rec.Body)
	}
	f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":false,"clusters":["kind-dev"],"baseURL":"`+m.srv.URL+`"}`)
	if rec := f.send(t, id); rec.Code != http.StatusForbidden {
		t.Errorf("turned off: %d %s", rec.Code, rec.Body)
	}
	f.do(t, f.api.HandleSave, http.MethodPost, `{"enabled":true,"clusters":["kind-dev"],"baseURL":"`+m.srv.URL+`","model":"claude-sonnet-5-5"}`)
	if rec := f.send(t, id); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "preview") {
		t.Errorf("model changed since the preview: %d %s", rec.Code, rec.Body)
	}
	if len(m.bodies) != 0 {
		t.Error("nothing is sent while a gate fails")
	}
}

func TestSendRefusesUnknownAndExpiredPreviews(t *testing.T) {
	f, m, id := sendFixture(t)
	if rec := f.send(t, "nope"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown: %d %s", rec.Code, rec.Body)
	}
	f.api.now = func() time.Time { return time.Now().Add(11 * time.Minute) }
	if rec := f.send(t, id); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "preview") {
		t.Errorf("expired: %d %s", rec.Code, rec.Body)
	}
	if len(m.bodies) != 0 {
		t.Error("nothing is sent")
	}
}

func TestAFailedSendIsReadableAndCanBeRetried(t *testing.T) {
	f, m, id := sendFixture(t)
	m.status = http.StatusUnauthorized
	rec := f.send(t, id)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "401") || !strings.Contains(rec.Body.String(), "invalid x-api-key") {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
	if last := f.entries[len(f.entries)-1]; last.Action != "triage:send" || !strings.Contains(last.Detail, "error=") {
		t.Errorf("audit = %+v", last)
	}
	m.status = http.StatusOK
	if rec := f.send(t, id); rec.Code != http.StatusOK {
		t.Errorf("retry: %d %s", rec.Code, rec.Body)
	}
}

func TestTriageSendNeedsTheUIToken(t *testing.T) {
	f := newTriageFixture(t)
	srv := httptest.NewServer(Router(Deps{Clusters: f.sm.mgr, Triage: f.api}, "ui-token"))
	t.Cleanup(srv.Close)
	res, err := http.Post(srv.URL+"/api/triage/send", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("%d", res.StatusCode)
	}
}
