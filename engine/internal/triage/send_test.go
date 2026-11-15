package triage

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeAPI stands in for the Messages API and answers with a structured
// triage; got holds what it received.
type fakeAPI struct {
	srv    *httptest.Server
	got    map[string]any
	key    string
	answer string
	stop   string
}

func newFakeAPI(t *testing.T, answer string) *fakeAPI {
	t.Helper()
	f := &fakeAPI{answer: answer, stop: "end_turn"}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			http.NotFound(w, r)
			return
		}
		f.key = r.Header.Get("X-Api-Key")
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &f.got)
		w.Header().Set("Content-Type", "application/json")
		text, _ := json.Marshal(f.answer)
		stopDetails := "null"
		if f.stop == "refusal" {
			stopDetails = `{"type":"refusal","category":"cyber","explanation":"declined"}`
		}
		_, _ = io.WriteString(w, `{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5",`+
			`"content":[{"type":"text","text":`+string(text)+`}],"stop_reason":"`+f.stop+`","stop_details":`+stopDetails+`,`+
			`"usage":{"input_tokens":812,"output_tokens":240}}`)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

const answer = `{"summary":"api crashes on start: a nil map write panics, exit 2.",
"findings":[
 {"title":"nil map panic at startup","likelihood":"likely","explanation":"The previous run panicked.","evidence":["E2","E9"],"nextSteps":["Check the config the new image reads"]},
 {"title":"a node problem","likelihood":"unlikely","explanation":"Pure guess.","evidence":["E7"],"nextSteps":[]}
],
"missingEvidence":"the config the app loads"}`

func TestSendReturnsFindingsWithOnlyResolvableEvidence(t *testing.T) {
	f := newFakeAPI(t, answer)
	r := BuildRequest("claude-opus-5-5", f.srv.URL, bundle())
	res, err := Send(context.Background(), f.srv.URL, "sk-ant-test-1234567890", r, []string{"E1", "E2"})
	if err != nil {
		t.Fatal(err)
	}
	if f.key != "sk-ant-test-1234567890" {
		t.Errorf("key header = %q", f.key)
	}
	if f.got["model"] != "claude-opus-5-5" {
		t.Errorf("sent = %v", f.got)
	}
	if res.Summary == "" || len(res.Findings) != 1 || res.Dropped != 1 {
		t.Fatalf("result = %+v", res)
	}
	fd := res.Findings[0]
	if fd.Title != "nil map panic at startup" || len(fd.Evidence) != 1 || fd.Evidence[0] != "E2" || fd.Likelihood != "likely" {
		t.Errorf("finding = %+v (E9 doesn't exist, so only E2 stays)", fd)
	}
	if res.MissingEvidence == "" || res.InputTokens != 812 || res.OutputTokens != 240 || res.Model != "claude-opus-5-5" {
		t.Errorf("result = %+v", res)
	}
}

func TestARefusalIsReportedNotInvented(t *testing.T) {
	f := newFakeAPI(t, "")
	f.stop = "refusal"
	res, err := Send(context.Background(), f.srv.URL, "k-1234567890abcdef", BuildRequest("claude-opus-5-5", f.srv.URL, bundle()), []string{"E1", "E2"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Refusal == nil || res.Refusal.Category != "cyber" || len(res.Findings) != 0 {
		t.Errorf("result = %+v", res)
	}
}

func TestAnUnreadableAnswerIsAnError(t *testing.T) {
	f := newFakeAPI(t, "not json")
	if _, err := Send(context.Background(), f.srv.URL, "k-1234567890abcdef", BuildRequest("m", f.srv.URL, bundle()), nil); err == nil || !strings.Contains(err.Error(), "answer") {
		t.Errorf("err = %v", err)
	}
}

func TestAPIErrorsAreReadable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
	}))
	t.Cleanup(srv.Close)
	_, err := Send(context.Background(), srv.URL, "bad-key-1234567890", BuildRequest("m", srv.URL, bundle()), nil)
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Errorf("err = %v", err)
	}
}
