package kubetools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
)

// writableKinds are the kinds an assistant may propose changes to:
// workloads and how they're exposed. No Pods, Jobs, volumes, nodes,
// namespaces, ConfigMaps or Secrets.
var writableKinds = []string{"cronjobs", "daemonsets", "deployments", "ingresses", "services", "statefulsets"}

func registerProposals(reg *mcp.Registry, t *tools) {
	reg.Add(mcp.Tool{
		Name:  "propose_change",
		Title: "Propose a change",
		Description: "Proposes a change to one workload, Service or Ingress as a strategic merge patch of spec (and metadata labels/annotations). " +
			"It changes nothing: Kubebay dry-runs it and shows the diff to its user, who approves or rejects it in Kubebay. " +
			"Then poll get_proposal_status. Proposals expire after 5 minutes. Only works when Kubebay's user has allowed proposals.",
		InputSchema: json.RawMessage(fmt.Sprintf(`{"type":"object","properties":{`+
			`"cluster":{"type":"string"},"kind":{"type":"string","enum":%s},"namespace":{"type":"string"},"name":{"type":"string"},`+
			`"patch":{"type":"object","description":"Strategic merge patch, e.g. {\"spec\":{\"replicas\":3}}. Containers merge by name."},`+
			`"reason":{"type":"string","description":"Why, in a sentence, for the person approving it."}},`+
			`"required":["cluster","kind","namespace","name","patch","reason"],"additionalProperties":false}`, mustJSON(writableKinds))),
		Handler: t.audited(t.propose),
	})
	reg.Add(mcp.Tool{
		Name:        "get_proposal_status",
		Title:       "Proposal status",
		Description: "Whether a proposal from propose_change is still pending, or was applied, rejected, expired, or became stale because the object changed.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"proposalId":{"type":"string"}},"required":["proposalId"],"additionalProperties":false}`),
		Handler:     t.audited(t.proposalStatus),
	})
}

type proposeArgs struct {
	Cluster   string          `json:"cluster"`
	Kind      string          `json:"kind"`
	Namespace string          `json:"namespace"`
	Name      string          `json:"name"`
	Patch     json.RawMessage `json:"patch"`
	Reason    string          `json:"reason"`
}

func (t *tools) propose(ctx context.Context, raw json.RawMessage, c *call) (mcp.Result, error) {
	var a proposeArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return mcp.Result{}, mcp.ArgError("invalid arguments: " + err.Error())
	}
	c.cluster, c.namespace = a.Cluster, a.Namespace
	c.detail = fmt.Sprintf("kind=%s name=%s", a.Kind, a.Name)
	if t.d.Writes == nil || !t.d.Writes() {
		return mcp.Result{}, fmt.Errorf("Kubebay's user hasn't allowed assistants to propose changes; they can turn it on in Kubebay's Settings, under AI assistants")
	}
	if !contains(writableKinds, a.Kind) {
		return mcp.Result{}, mcp.ArgError("kind must be one of " + strings.Join(writableKinds, ", "))
	}
	if a.Cluster == "" || a.Namespace == "" || a.Name == "" || len(a.Patch) == 0 || strings.TrimSpace(a.Reason) == "" {
		return mcp.Result{}, mcp.ArgError("cluster, namespace, name, patch and reason are required")
	}
	if err := t.checkNamespace(a.Cluster, a.Namespace, false); err != nil {
		return mcp.Result{}, err
	}
	p, err := t.d.Proposals.Propose(ctx, proposals.Input{
		Cluster: a.Cluster, Kind: a.Kind, GVR: kinds[a.Kind].gvr, Namespace: a.Namespace, Name: a.Name,
		Patch: a.Patch, Reason: a.Reason,
		Client:    strings.TrimSpace(c.info.ClientName + " " + c.info.ClientVersion),
		RequestID: c.info.RequestID,
	})
	if err != nil {
		return mcp.Result{}, err
	}
	c.detail += " proposal=" + p.ID
	return jsonResult(map[string]any{
		"proposalId":   p.ID,
		"status":       p.Status,
		"changedPaths": p.ChangedPaths,
		"diff":         p.ModelDiff,
		"expiresAt":    p.Expires.UTC().Format(time.RFC3339),
		"next":         "Nothing has changed yet. Ask the user to review and approve it in Kubebay, then poll get_proposal_status.",
	})
}

func (t *tools) proposalStatus(_ context.Context, raw json.RawMessage, c *call) (mcp.Result, error) {
	var a struct {
		ProposalID string `json:"proposalId"`
	}
	if err := json.Unmarshal(raw, &a); err != nil || a.ProposalID == "" {
		return mcp.Result{}, mcp.ArgError("proposalId is required")
	}
	c.detail = "proposal=" + a.ProposalID
	p, ok := t.d.Proposals.Get(a.ProposalID)
	if !ok {
		return mcp.Result{}, fmt.Errorf("no proposal %s (finished proposals are kept for a while, then forgotten)", a.ProposalID)
	}
	c.cluster, c.namespace = p.Cluster, p.Namespace
	return jsonResult(map[string]any{
		"proposalId": p.ID,
		"status":     p.Status,
		"message":    p.Message,
		"object":     fmt.Sprintf("%s %s/%s", p.Kind, p.Namespace, p.Name),
		"expiresAt":  p.Expires.UTC().Format(time.RFC3339),
	})
}
