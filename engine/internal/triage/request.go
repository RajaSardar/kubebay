// Package triage builds what Kubebay's incident triage sends to a model
// (backlog #13): one bounded, read-only, redacted evidence bundle about one
// pod. The user sees this exact request before anything is sent.
package triage

import (
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/anthropics/anthropic-sdk-go"

	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

// DefaultModel and DefaultBaseURL apply until the user sets their own (an
// enterprise proxy speaking the Messages API, for instance).
const (
	DefaultModel   = "claude-opus-5-5"
	DefaultBaseURL = "https://api.anthropic.com"
	// Thinking shares this budget with the answer, which is short.
	maxTokens = 16000
)

// SystemPrompt keeps triage honest: an invented root cause during an outage
// is the core risk, so the model is held to the bundle and must cite it.
const SystemPrompt = `You help an engineer find out why a Kubernetes pod is unhealthy.
You get one evidence bundle. Every section starts with an ID such as [E3].
Use only the evidence in the bundle. Cite the IDs of the sections that support every finding, in its evidence list.
A finding that cites no section of the bundle is not shown, so don't offer one.
If the evidence is not enough to name a cause, say so in the summary, return fewer findings or none, and say in missingEvidence what to look at next, instead of guessing.
Lead with the most likely cause, then any others, most likely first. Rate each as likely, possible or unlikely.
Write next steps as checks and fixes for a person to review. Never claim to have run a command or changed anything.
Values shown as <redacted> were removed on purpose; don't ask for them.`

// answerSchema is the shape every answer must take, so Kubebay can check
// each citation against the bundle before showing it.
var answerSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"summary": map[string]any{"type": "string"},
		"findings": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":       map[string]any{"type": "string"},
					"likelihood":  map[string]any{"type": "string", "enum": []string{"likely", "possible", "unlikely"}},
					"explanation": map[string]any{"type": "string"},
					"evidence":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"nextSteps":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				},
				"required":             []string{"title", "likelihood", "explanation", "evidence", "nextSteps"},
				"additionalProperties": false,
			},
		},
		"missingEvidence": map[string]any{"type": "string"},
	},
	"required":             []string{"summary", "findings", "missingEvidence"},
	"additionalProperties": false,
}

var (
	// Models that take output_config.effort.
	effortModels = regexp.MustCompile(`^claude-(opus|sonnet|fable)-5(-|$)|^claude-opus-4-[5-9](-|$)|^claude-sonnet-4-6(-|$)`)
	// Models with server-side refusal fallbacks.
	fallbackModels = map[string]bool{"claude-opus-5-5": true, "claude-opus-5": true, "claude-fable-5-1": true, "claude-sonnet-5-5": true}
)

// Request is a Messages API call: Params is the body, Betas its
// anthropic-beta header.
type Request struct {
	Params anthropic.BetaMessageNewParams
	Betas  []anthropic.AnthropicBeta
}

func BuildRequest(model, baseURL string, e kubetools.Evidence) Request {
	content := fmt.Sprintf("Cluster %s, pod %s/%s. The evidence bundle follows.\n\n%s", e.Cluster, e.Namespace, e.Pod, e.Text())
	p := anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: maxTokens,
		System:    []anthropic.BetaTextBlockParam{{Text: SystemPrompt}},
		Messages:  []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(content))},
		OutputConfig: anthropic.BetaOutputConfigParam{
			Format: anthropic.BetaJSONOutputFormatParam{Schema: answerSchema},
		},
	}
	// Triage is where a shallow answer costs most.
	if effortModels.MatchString(model) {
		p.OutputConfig.Effort = anthropic.BetaOutputConfigEffortHigh
	}
	var betas []anthropic.AnthropicBeta
	// A proxy may not know the beta, so fallbacks ride only on Anthropic's
	// own endpoint.
	if baseURL == DefaultBaseURL && fallbackModels[model] {
		p.Fallbacks = anthropic.BetaFallbacksParamOfDefault()
		betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
		p.Betas = betas
	}
	return Request{Params: p, Betas: betas}
}

// ApproxTokens estimates input size at about four characters per token.
func ApproxTokens(r Request) int {
	b, _ := json.Marshal(r.Params)
	return len(b) / 4
}
