package httpapi

import (
	"errors"
	"regexp"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// PolicyCause is one structured cause from a Status's Details.Causes — set by
// some (not all) admission webhooks, e.g. per-field validation failures.
type PolicyCause struct {
	Type    string `json:"type,omitempty"`
	Message string `json:"message,omitempty"`
	Field   string `json:"field,omitempty"`
}

// PolicyRejection is what an apply's dry-run (or real apply) surfaces when a
// validating admission webhook — Kyverno, Gatekeeper, or any other — denies
// the request. Kubebay's dry-run already triggers this; today the signal is
// thrown away as a flat 502 error string. Structuring it turns a passive
// error message into an active pre-flight guardrail in the UI.
type PolicyRejection struct {
	// Engine is a best-effort guess ("kyverno", "gatekeeper", or "" if the
	// webhook name doesn't match either) — cosmetic labeling only, never used
	// to change behavior.
	Engine  string        `json:"engine"`
	Webhook string        `json:"webhook"`
	Message string        `json:"message"`
	Causes  []PolicyCause `json:"causes,omitempty"`
}

// admissionWebhookRe matches the fixed message format the API server itself
// uses for every validating-webhook denial (apiserver's webhook admission
// plugin, not vendor-specific) — see k8s.io/apiserver's webhook error
// wrapping: `admission webhook "<name>" denied the request: <detail>`.
var admissionWebhookRe = regexp.MustCompile(`(?s)^admission webhook "([^"]+)" denied the request:\s*(.*)$`)

// parsePolicyRejection returns nil unless err is a Kubernetes API status
// error whose message matches the admission-webhook-denial format — i.e. it
// never misclassifies an ordinary apply failure (network error, not found,
// conflict, ...) as a policy rejection.
func parsePolicyRejection(err error) *PolicyRejection {
	var statusErr apierrors.APIStatus
	if !errors.As(err, &statusErr) {
		return nil
	}
	status := statusErr.Status()
	m := admissionWebhookRe.FindStringSubmatch(status.Message)
	if m == nil {
		return nil
	}
	webhook := m[1]
	message := strings.TrimSpace(m[2])
	if message == "" {
		message = status.Message
	}

	var engine string
	switch lower := strings.ToLower(webhook); {
	case strings.Contains(lower, "kyverno"):
		engine = "kyverno"
	case strings.Contains(lower, "gatekeeper"):
		engine = "gatekeeper"
	}

	var causes []PolicyCause
	if status.Details != nil {
		for _, c := range status.Details.Causes {
			causes = append(causes, PolicyCause{Type: string(c.Type), Message: c.Message, Field: c.Field})
		}
	}

	return &PolicyRejection{Engine: engine, Webhook: webhook, Message: message, Causes: causes}
}
