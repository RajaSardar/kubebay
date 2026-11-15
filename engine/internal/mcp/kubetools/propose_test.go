package kubetools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
)

// fakePatcher holds shop/api at two replicas and merges spec patches.
type fakePatcher struct{ replicas float64 }

func (f *fakePatcher) obj() map[string]any {
	return map[string]any{
		"apiVersion": "apps/v1", "kind": "Deployment",
		"metadata": map[string]any{"name": "api", "namespace": "shop", "resourceVersion": "7"},
		"spec":     map[string]any{"replicas": f.replicas},
	}
}

func (f *fakePatcher) Get(context.Context, string, string, string, string) (map[string]any, error) {
	return f.obj(), nil
}

func (f *fakePatcher) Patch(_ context.Context, _, _, _, _ string, patch []byte, dryRun bool) (map[string]any, error) {
	var p struct {
		Spec struct {
			Replicas float64 `json:"replicas"`
		} `json:"spec"`
	}
	_ = json.Unmarshal(patch, &p)
	o := f.obj()
	o["spec"] = map[string]any{"replicas": p.Spec.Replicas}
	if !dryRun {
		f.replicas = p.Spec.Replicas
	}
	return o, nil
}

type proposeSetup struct {
	*setup
	writes  bool
	store   *proposals.Store
	patcher *fakePatcher
}

func newProposeSetup() *proposeSetup {
	s := &proposeSetup{setup: &setup{src: newSetup().src, scope: Scope{Clusters: map[string][]string{"kind-dev": nil}}}, patcher: &fakePatcher{replicas: 2}}
	s.store = proposals.New(s.patcher, nil)
	s.reg = mcp.NewRegistry()
	Register(s.reg, Deps{
		Source:    s.src,
		Scope:     func() Scope { return s.scope },
		Audit:     func(e audit.Entry) { s.entries = append(s.entries, e) },
		Proposals: s.store,
		Writes:    func() bool { return s.writes },
	})
	return s
}

const scaleArgs = `{"cluster":"kind-dev","kind":"deployments","namespace":"shop","name":"api","patch":{"spec":{"replicas":4}},"reason":"CPU-bound at 2 replicas"}`

func TestProposeChangeNeedsTheUsersPermission(t *testing.T) {
	s := newProposeSetup()
	if _, err := s.call(t, "propose_change", scaleArgs); err == nil || !strings.Contains(err.Error(), "Settings") {
		t.Errorf("writes off: %v", err)
	}
	if len(s.store.Recent()) != 0 {
		t.Error("nothing proposed")
	}
}

func TestProposeChangeRecordsAPendingProposalAndChangesNothing(t *testing.T) {
	s := newProposeSetup()
	s.writes = true
	r, err := s.call(t, "propose_change", scaleArgs)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		ProposalID   string   `json:"proposalId"`
		Status       string   `json:"status"`
		ChangedPaths []string `json:"changedPaths"`
		Diff         string   `json:"diff"`
		ExpiresAt    string   `json:"expiresAt"`
		Next         string   `json:"next"`
	}
	if err := json.Unmarshal([]byte(text(r)), &out); err != nil {
		t.Fatalf("%v: %s", err, text(r))
	}
	if out.ProposalID == "" || out.Status != "pending" || len(out.ChangedPaths) != 1 || !strings.Contains(out.Diff, "+  replicas: 4") || out.ExpiresAt == "" {
		t.Errorf("result = %s", text(r))
	}
	if !strings.Contains(out.Next, "Kubebay") || !strings.Contains(out.Next, "get_proposal_status") {
		t.Errorf("next = %q", out.Next)
	}
	if s.patcher.replicas != 2 {
		t.Error("proposing must not change the object")
	}
	if e := s.entries[len(s.entries)-1]; e.Action != "mcp:propose_change" || e.Source != "mcp" || e.UserAgent != "claude-desktop 1.0" {
		t.Errorf("audit = %+v", e)
	}
}

func TestProposeChangeStaysInScopeAndOnWritableKinds(t *testing.T) {
	s := newProposeSetup()
	s.writes = true
	s.scope = Scope{Clusters: map[string][]string{"kind-dev": {"ops"}}}
	for _, args := range []string{
		scaleArgs, // namespace out of scope
		`{"cluster":"prod","kind":"deployments","namespace":"shop","name":"api","patch":{"spec":{"replicas":4}},"reason":"x"}`,
		`{"cluster":"kind-dev","kind":"pods","namespace":"ops","name":"x","patch":{"spec":{}},"reason":"x"}`,
		`{"cluster":"kind-dev","kind":"configmaps","namespace":"ops","name":"x","patch":{"data":{}},"reason":"x"}`,
		`{"cluster":"kind-dev","kind":"secrets","namespace":"ops","name":"x","patch":{"data":{}},"reason":"x"}`,
		`{"cluster":"kind-dev","kind":"deployments","name":"api","patch":{"spec":{}},"reason":"x"}`,
		`{"cluster":"kind-dev","kind":"deployments","namespace":"ops","name":"api","reason":"x"}`,
		`{"cluster":"kind-dev","kind":"deployments","namespace":"ops","name":"api","patch":{"spec":{"replicas":4}}}`,
	} {
		if _, err := s.call(t, "propose_change", args); err == nil {
			t.Errorf("accepted: %s", args)
		}
	}
	if len(s.store.Recent()) != 0 {
		t.Error("nothing proposed")
	}
}

func TestGetProposalStatusFollowsTheDecision(t *testing.T) {
	s := newProposeSetup()
	s.writes = true
	r, _ := s.call(t, "propose_change", scaleArgs)
	var p struct {
		ProposalID string `json:"proposalId"`
	}
	_ = json.Unmarshal([]byte(text(r)), &p)
	status := func() string {
		r, err := s.call(t, "get_proposal_status", `{"proposalId":"`+p.ProposalID+`"}`)
		if err != nil {
			t.Fatal(err)
		}
		return text(r)
	}
	if !strings.Contains(status(), `"status":"pending"`) {
		t.Errorf("status = %s", status())
	}
	if _, err := s.store.Approve(context.Background(), p.ProposalID); err != nil {
		t.Fatal(err)
	}
	if got := status(); !strings.Contains(got, `"status":"applied"`) || !strings.Contains(got, "resourceVersion") {
		t.Errorf("status = %s", got)
	}
	if s.patcher.replicas != 4 {
		t.Error("approval applied the change")
	}
	if _, err := s.call(t, "get_proposal_status", `{"proposalId":"p-nope"}`); err == nil {
		t.Error("unknown proposal")
	}
}
