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

// wire is the request body as it goes over the wire.
type wire struct {
	Model     string `json:"model"`
	MaxTokens int    `json:"max_tokens"`
	System    []struct {
		Text string `json:"text"`
	} `json:"system"`
	Messages []struct {
		Role    string `json:"role"`
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	} `json:"messages"`
	OutputConfig struct {
		Effort string `json:"effort"`
		Format struct {
			Type   string         `json:"type"`
			Schema map[string]any `json:"schema"`
		} `json:"format"`
	} `json:"output_config"`
	Fallbacks any `json:"fallbacks"`
}

func body(t *testing.T, r Request) wire {
	t.Helper()
	b, err := json.Marshal(r.Params)
	if err != nil {
		t.Fatal(err)
	}
	var w wire
	if err := json.Unmarshal(b, &w); err != nil {
		t.Fatalf("%v: %s", err, b)
	}
	return w
}

func TestTheRequestIsAMessagesAPIBodyCarryingTheBundle(t *testing.T) {
	w := body(t, BuildRequest("claude-opus-5-5", DefaultBaseURL, bundle()))
	if w.Model != "claude-opus-5-5" || w.MaxTokens < 4096 || len(w.Messages) != 1 || w.Messages[0].Role != "user" || len(w.System) != 1 {
		t.Fatalf("request = %+v", w)
	}
	c := w.Messages[0].Content[0].Text
	for _, want := range []string{"kind-dev", "shop/api-7d9-x", "[E1] Pod shop/api-7d9-x", "[E2] Logs of api (previous run", "panic: nil map"} {
		if !strings.Contains(c, want) {
			t.Errorf("content should carry %q:\n%s", want, c)
		}
	}
}

// Every finding must cite sections by ID, in a JSON shape Kubebay can check.
func TestTheAnswerIsStructuredWithEvidenceIDs(t *testing.T) {
	w := body(t, BuildRequest("claude-opus-5-5", DefaultBaseURL, bundle()))
	if w.OutputConfig.Format.Type != "json_schema" {
		t.Fatalf("format = %+v", w.OutputConfig.Format)
	}
	s, _ := json.Marshal(w.OutputConfig.Format.Schema)
	for _, want := range []string{`"findings"`, `"evidence"`, `"nextSteps"`, `"likelihood"`, `"additionalProperties":false`} {
		if !strings.Contains(string(s), want) {
			t.Errorf("schema should have %s: %s", want, s)
		}
	}
	if w.OutputConfig.Effort != "high" {
		t.Errorf("triage is intelligence-sensitive: effort %q", w.OutputConfig.Effort)
	}
}

// Refusal fallbacks ride only on Anthropic's own endpoint (a proxy may not
// know the beta) and only for models that have them.
func TestFallbacksOnlyOnTheOfficialEndpoint(t *testing.T) {
	official := BuildRequest("claude-opus-5-5", DefaultBaseURL, bundle())
	if w := body(t, official); w.Fallbacks != "default" || len(official.Betas) != 1 || official.Betas[0] != "server-side-fallback-2026-07-01" {
		t.Errorf("official: fallbacks=%v betas=%v", w.Fallbacks, official.Betas)
	}
	proxy := BuildRequest("claude-opus-5-5", "https://llm.corp.example", bundle())
	if w := body(t, proxy); w.Fallbacks != nil || len(proxy.Betas) != 0 {
		t.Errorf("proxy: fallbacks=%v betas=%v", w.Fallbacks, proxy.Betas)
	}
	older := BuildRequest("claude-sonnet-4-5", DefaultBaseURL, bundle())
	if w := body(t, older); w.Fallbacks != nil || w.OutputConfig.Effort != "" {
		t.Errorf("older model: fallbacks=%v effort=%q", w.Fallbacks, w.OutputConfig.Effort)
	}
}

// The instructions that keep triage honest: evidence only, cite it, say
// when it isn't enough, and never claim to have acted.
func TestTheSystemPromptHoldsTheModelToTheEvidence(t *testing.T) {
	s := strings.ToLower(body(t, BuildRequest("m", DefaultBaseURL, bundle())).System[0].Text)
	for _, want := range []string{"only the evidence", "cite", "not enough", "never claim", "<redacted>"} {
		if !strings.Contains(s, want) {
			t.Errorf("system prompt should say %q:\n%s", want, s)
		}
	}
}

func TestApproxTokensIsAboutFourCharactersEach(t *testing.T) {
	r := BuildRequest("m", DefaultBaseURL, bundle())
	b, _ := json.Marshal(r.Params)
	if n := ApproxTokens(r); n < len(b)/5 || n > len(b)/3 {
		t.Errorf("approx tokens %d for %d bytes", n, len(b))
	}
}
