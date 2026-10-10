package triage

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

func bundle() kubetools.Evidence {
	return kubetools.Evidence{
		Cluster: "kind-dev", Namespace: "shop", Pod: "api-7d9-x",
		Sections: []kubetools.EvidenceSection{
			{ID: "E1", Title: "Pod shop/api-7d9-x", Text: "phase: Running"},
			{ID: "E2", Title: "Logs of api (previous run, exited 2: Error)", Text: "panic: nil map"},
		},
	}
}

func TestTheRequestIsAMessagesAPIBodyCarryingTheBundle(t *testing.T) {
	req := BuildRequest("claude-opus-5-5", bundle())
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Model     string `json:"model"`
		MaxTokens int    `json:"max_tokens"`
		System    string `json:"system"`
		Messages  []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.Model != "claude-opus-5-5" || got.MaxTokens <= 0 || len(got.Messages) != 1 || got.Messages[0].Role != "user" {
		t.Fatalf("request = %s", b)
	}
	c := got.Messages[0].Content
	for _, want := range []string{"kind-dev", "shop/api-7d9-x", "[E1] Pod shop/api-7d9-x", "[E2] Logs of api (previous run", "panic: nil map"} {
		if !strings.Contains(c, want) {
			t.Errorf("content should carry %q:\n%s", want, c)
		}
	}
}

// The instructions that keep triage honest: evidence only, cite it, say
// when it isn't enough, and never claim to have acted.
func TestTheSystemPromptHoldsTheModelToTheEvidence(t *testing.T) {
	s := strings.ToLower(BuildRequest("m", bundle()).System)
	for _, want := range []string{"only the evidence", "cite", "not enough", "never claim", "<redacted>"} {
		if !strings.Contains(s, want) {
			t.Errorf("system prompt should say %q:\n%s", want, s)
		}
	}
}

func TestApproxTokensIsAboutFourCharactersEach(t *testing.T) {
	req := BuildRequest("m", bundle())
	b, _ := json.Marshal(req)
	if n := ApproxTokens(req); n < len(b)/5 || n > len(b)/3 {
		t.Errorf("approx tokens %d for %d bytes", n, len(b))
	}
}
