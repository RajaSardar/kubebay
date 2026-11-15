package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
)

// replicaPatcher holds shop/api in kind-dev and merges replica patches.
type replicaPatcher struct{ replicas float64 }

func (p *replicaPatcher) obj() map[string]any {
	return map[string]any{"metadata": map[string]any{"name": "api", "namespace": "shop", "resourceVersion": "7"}, "spec": map[string]any{"replicas": p.replicas}}
}
func (p *replicaPatcher) Get(context.Context, string, string, string, string) (map[string]any, error) {
	return p.obj(), nil
}
func (p *replicaPatcher) Patch(_ context.Context, _, _, _, _ string, patch []byte, dryRun bool) (map[string]any, error) {
	var b struct {
		Spec struct {
			Replicas float64 `json:"replicas"`
		} `json:"spec"`
	}
	_ = json.Unmarshal(patch, &b)
	o := p.obj()
	o["spec"] = map[string]any{"replicas": b.Spec.Replicas}
	if !dryRun {
		p.replicas = b.Spec.Replicas
	}
	return o, nil
}

func proposalFixture(t *testing.T) (*MCPAPI, *replicaPatcher, string) {
	t.Helper()
	a, _ := mcpFixture(t)
	pt := &replicaPatcher{replicas: 2}
	a.Proposals = proposals.New(pt, nil)
	if rec := mcpSave(t, a, `{"enabled":true,"writesEnabled":true,"clusters":{"kind-dev":["shop"]}}`); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	p, err := a.Proposals.Propose(context.Background(), proposals.Input{
		Cluster: "kind-dev", Kind: "deployments", GVR: "apps/v1/deployments", Namespace: "shop", Name: "api",
		Patch: json.RawMessage(`{"spec":{"replicas":4}}`), Reason: "CPU-bound", Client: "claude-code 2.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	return a, pt, p.ID
}

// decide calls approve or reject through chi so {id} resolves.
func decide(t *testing.T, a *MCPAPI, id, verb string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Post("/api/mcp/proposals/{id}/approve", a.HandleApprove)
	r.Post("/api/mcp/proposals/{id}/reject", a.HandleReject)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/mcp/proposals/"+id+"/"+verb, nil))
	return rec
}

func TestProposalsAreOffUntilTurnedOn(t *testing.T) {
	a, _ := mcpFixture(t)
	mcpSave(t, a, `{"enabled":true,"clusters":{"kind-dev":[]}}`)
	if a.Writes() {
		t.Error("proposals are off by default")
	}
	mcpSave(t, a, `{"enabled":true,"writesEnabled":true,"clusters":{"kind-dev":[]}}`)
	if !a.Writes() {
		t.Error("turned on")
	}
	mcpSave(t, a, `{"enabled":false,"writesEnabled":true,"clusters":{"kind-dev":[]}}`)
	if a.Writes() {
		t.Error("MCP off means no proposals either")
	}
}

func TestTheUIListsPendingProposalsWithTheFullDiff(t *testing.T) {
	a, _, id := proposalFixture(t)
	rec := httptest.NewRecorder()
	a.HandleProposals(rec, httptest.NewRequest(http.MethodGet, "/api/mcp/proposals", nil))
	var got struct {
		Pending []struct {
			ID     string `json:"id"`
			Diff   string `json:"diff"`
			Reason string `json:"reason"`
			Client string `json:"client"`
		} `json:"pending"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || len(got.Pending) != 1 || got.Pending[0].ID != id || !strings.Contains(got.Pending[0].Diff, "+  replicas: 4") || got.Pending[0].Reason != "CPU-bound" || got.Pending[0].Client != "claude-code 2.1" {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

func TestApprovingInKubebayAppliesTheChange(t *testing.T) {
	a, pt, id := proposalFixture(t)
	rec := decide(t, a, id, "approve")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"applied"`) || pt.replicas != 4 {
		t.Errorf("%d %s replicas=%v", rec.Code, rec.Body, pt.replicas)
	}
	if rec := decide(t, a, id, "approve"); rec.Code != http.StatusConflict {
		t.Errorf("second approve: %d", rec.Code)
	}
}

func TestRejectingAppliesNothing(t *testing.T) {
	a, pt, id := proposalFixture(t)
	if rec := decide(t, a, id, "reject"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"rejected"`) || pt.replicas != 2 {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

// Scope is checked again at approval: a namespace taken out of scope after
// the proposal can't be written.
func TestApprovalRechecksScope(t *testing.T) {
	a, pt, id := proposalFixture(t)
	mcpSave(t, a, `{"enabled":true,"writesEnabled":true,"clusters":{"kind-dev":["ops"]}}`)
	if rec := decide(t, a, id, "approve"); rec.Code != http.StatusForbidden || pt.replicas != 2 {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

// The kill switch covers proposals: turning MCP or proposals off rejects
// whatever is waiting.
func TestTurningProposalsOffRejectsWhatIsWaiting(t *testing.T) {
	for _, body := range []string{
		`{"enabled":true,"writesEnabled":false,"clusters":{"kind-dev":["shop"]}}`,
		`{"enabled":false,"writesEnabled":true,"clusters":{"kind-dev":["shop"]}}`,
	} {
		a, pt, id := proposalFixture(t)
		mcpSave(t, a, body)
		p, _ := a.Proposals.Get(id)
		if p.Status != proposals.StatusRejected || pt.replicas != 2 {
			t.Errorf("%s: status %s", body, p.Status)
		}
	}
}

func TestProposalRoutesNeedTheUIToken(t *testing.T) {
	a, _, id := proposalFixture(t)
	srv := httptest.NewServer(Router(Deps{MCP: a}, "ui-token"))
	t.Cleanup(srv.Close)
	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, "/api/mcp/proposals"},
		{http.MethodPost, "/api/mcp/proposals/" + id + "/approve"},
		{http.MethodPost, "/api/mcp/proposals/" + id + "/reject"},
	} {
		req, _ := http.NewRequest(rt.method, srv.URL+rt.path, nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s without the token: %d", rt.method, rt.path, res.StatusCode)
		}
	}
	// The MCP token can't approve: only the person in Kubebay can.
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/mcp/proposals/"+id+"/approve", nil)
	c, _ := readConn(t)
	req.Header.Set("Authorization", "Bearer "+c.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("approve with the MCP token: %d", res.StatusCode)
	}
}
