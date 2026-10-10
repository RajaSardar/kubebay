// Package triage builds what Kubebay's incident triage sends to a model
// (backlog #13): one bounded, read-only, redacted evidence bundle about one
// pod. The user sees this exact request before anything is sent.
package triage

import (
	"encoding/json"
	"fmt"

	"github.com/RajaSardar/kubebay/engine/internal/mcp/kubetools"
)

// DefaultModel and DefaultBaseURL apply until the user sets their own (an
// enterprise proxy speaking the Messages API, for instance).
const (
	DefaultModel   = "claude-opus-5-5"
	DefaultBaseURL = "https://api.anthropic.com"
	maxTokens      = 2048
)

// SystemPrompt keeps triage honest: an invented root cause during an outage
// is the core risk, so the model is held to the bundle and must cite it.
const SystemPrompt = `You help an engineer find out why a Kubernetes pod is unhealthy.
You get one evidence bundle. Every section starts with an ID such as [E3].
Use only the evidence in the bundle. Cite the IDs of the sections that support every finding.
If the evidence is not enough to name a cause, say so and say what to look at next, instead of guessing.
Lead with the most likely cause, then any others, most likely first.
Suggest checks and fixes as text for a person to review. Never claim to have run a command or changed anything.
Values shown as <redacted> were removed on purpose; don't ask for them.`

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Request is a Messages API body: POST {baseURL}/v1/messages.
type Request struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	System    string    `json:"system"`
	Messages  []Message `json:"messages"`
}

func BuildRequest(model string, e kubetools.Evidence) Request {
	content := fmt.Sprintf("Cluster %s, pod %s/%s. The evidence bundle follows.\n\n%s", e.Cluster, e.Namespace, e.Pod, e.Text())
	return Request{
		Model:     model,
		MaxTokens: maxTokens,
		System:    SystemPrompt,
		Messages:  []Message{{Role: "user", Content: content}},
	}
}

// ApproxTokens estimates input size at about four characters per token.
func ApproxTokens(r Request) int {
	b, _ := json.Marshal(r)
	return len(b) / 4
}
