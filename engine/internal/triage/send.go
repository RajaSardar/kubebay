package triage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// Finding is one cause the model offers, with the bundle sections it cites.
type Finding struct {
	Title       string   `json:"title"`
	Likelihood  string   `json:"likelihood"`
	Explanation string   `json:"explanation"`
	Evidence    []string `json:"evidence"`
	NextSteps   []string `json:"nextSteps"`
}

// Refusal is the model declining to answer, reported as is.
type Refusal struct {
	Category    string `json:"category,omitempty"`
	Explanation string `json:"explanation,omitempty"`
}

// Result is what Kubebay shows: findings citing sections that exist, and
// how many it dropped because they didn't.
type Result struct {
	Summary         string    `json:"summary"`
	Findings        []Finding `json:"findings"`
	Dropped         int       `json:"dropped"`
	MissingEvidence string    `json:"missingEvidence,omitempty"`
	Model           string    `json:"model"`
	InputTokens     int64     `json:"inputTokens"`
	OutputTokens    int64     `json:"outputTokens"`
	Refusal         *Refusal  `json:"refusal,omitempty"`
}

// Send makes the call the user reviewed. Only apiKey and baseURL reach the
// SDK: it reads no credentials or endpoint from the environment, so the
// request goes where the preview said it would. sectionIDs are the bundle's
// section IDs; a citation outside them is removed, and a finding left with
// none is dropped.
func Send(ctx context.Context, baseURL, apiKey string, r Request, sectionIDs []string) (Result, error) {
	client := anthropic.NewClient(
		option.WithoutEnvironmentDefaults(),
		option.WithBaseURL(baseURL),
		option.WithAPIKey(apiKey),
	)
	msg, err := client.Beta.Messages.New(ctx, r.Params)
	if err != nil {
		return Result{}, readable(err)
	}
	res := Result{Model: string(msg.Model), InputTokens: msg.Usage.InputTokens, OutputTokens: msg.Usage.OutputTokens, Findings: []Finding{}}
	switch msg.StopReason {
	case anthropic.BetaStopReasonRefusal:
		res.Refusal = &Refusal{Category: string(msg.StopDetails.Category), Explanation: msg.StopDetails.Explanation}
		return res, nil
	case anthropic.BetaStopReasonMaxTokens:
		return res, errors.New("the answer was cut off at the token limit; try again")
	}
	var text strings.Builder
	for _, b := range msg.Content {
		if b.Type == "text" {
			text.WriteString(b.Text)
		}
	}
	var ans struct {
		Summary         string    `json:"summary"`
		Findings        []Finding `json:"findings"`
		MissingEvidence string    `json:"missingEvidence"`
	}
	if err := json.Unmarshal([]byte(text.String()), &ans); err != nil {
		return res, fmt.Errorf("couldn't read the model's answer: %w", err)
	}
	res.Summary, res.MissingEvidence = ans.Summary, ans.MissingEvidence
	known := make(map[string]bool, len(sectionIDs))
	for _, id := range sectionIDs {
		known[id] = true
	}
	for _, f := range ans.Findings {
		f.Evidence = cited(f.Evidence, known)
		if len(f.Evidence) == 0 {
			res.Dropped++
			continue
		}
		if f.NextSteps == nil {
			f.NextSteps = []string{}
		}
		res.Findings = append(res.Findings, f)
	}
	return res, nil
}

// cited keeps the IDs that name a section, once each, in order.
func cited(ids []string, known map[string]bool) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.Trim(strings.TrimSpace(id), "[]")
		if known[id] && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// readable turns an API error into its status and message, without the
// request dump the SDK's own message carries.
func readable(err error) error {
	var apiErr *anthropic.Error
	if !errors.As(err, &apiErr) {
		return fmt.Errorf("couldn't reach the model API: %w", err)
	}
	var body struct {
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal([]byte(apiErr.RawJSON()), &body)
	if body.Error.Message == "" {
		return fmt.Errorf("the model API answered %d", apiErr.StatusCode)
	}
	return fmt.Errorf("the model API answered %d: %s", apiErr.StatusCode, body.Error.Message)
}
