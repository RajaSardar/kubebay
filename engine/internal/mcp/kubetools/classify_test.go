package kubetools

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
)

// toolAccess is the reviewed classification of every MCP tool. A new tool
// fails the guard below until it has a row here, and a row marked write is
// hidden and refused while writes are off. Do not weaken it to get green:
// classify the tool.
var toolAccess = map[string]mcp.Access{
	"list_clusters":       mcp.AccessRead,
	"list_resources":      mcp.AccessRead,
	"describe_resource":   mcp.AccessRead,
	"get_logs":            mcp.AccessRead,
	"list_events":         mcp.AccessRead,
	"get_manifest":        mcp.AccessRead,
	"get_cluster_health":  mcp.AccessRead,
	"propose_change":      mcp.AccessWrite,
	"get_proposal_status": mcp.AccessWrite,
}

func fullRegistry(writes func() bool) (*mcp.Registry, *proposals.Store, *[]audit.Entry) {
	s := newProposeSetup()
	var entries []audit.Entry
	reg := mcp.NewRegistryGated(writes)
	Register(reg, Deps{
		Source:    s.src,
		Scope:     func() Scope { return s.scope },
		Audit:     func(e audit.Entry) { entries = append(entries, e) },
		Proposals: s.store,
		Writes:    writes,
	})
	return reg, s.store, &entries
}

func rpc(t *testing.T, h http.Handler, id int, method, params string) map[string]any {
	t.Helper()
	body := `{"jsonrpc":"2.0","id":` + string(rune('0'+id)) + `,"method":"` + method + `","params":` + params + `}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out["result"].(map[string]any)
}

func TestEveryRegisteredToolIsClassified(t *testing.T) {
	reg, _, _ := fullRegistry(func() bool { return true })
	h := &mcp.Handler{Tools: reg, Name: "kubebay"}
	listed := map[string]bool{}
	for _, x := range rpc(t, h, 1, "tools/list", `{}`)["tools"].([]any) {
		m := x.(map[string]any)
		name := m["name"].(string)
		listed[name] = true
		want, ok := toolAccess[name]
		if !ok {
			t.Errorf("tool %q has no row in toolAccess: classify it as read or write", name)
			continue
		}
		tool, _ := reg.Get(name)
		if tool.Access != want {
			t.Errorf("tool %q: registered Access %v, table says %v", name, tool.Access, want)
		}
	}
	for name := range toolAccess {
		if !listed[name] {
			t.Errorf("toolAccess names %q but no such tool is registered", name)
		}
	}
}

func TestReadOnlyExposesNoWriteToolAndRunsNoWriteCall(t *testing.T) {
	reg, store, entries := fullRegistry(func() bool { return false })
	var refused []mcp.CallInfo
	h := &mcp.Handler{Tools: reg, Name: "kubebay", OnRefuse: func(ci mcp.CallInfo) { refused = append(refused, ci) }}
	for _, x := range rpc(t, h, 1, "tools/list", `{}`)["tools"].([]any) {
		name := x.(map[string]any)["name"].(string)
		if toolAccess[name] != mcp.AccessRead {
			t.Errorf("read-only listing exposes %q", name)
		}
	}
	for name, acc := range toolAccess {
		if acc != mcp.AccessWrite {
			continue
		}
		r := rpc(t, h, 2, "tools/call", `{"name":"`+name+`","arguments":{"cluster":"kind-dev","kind":"deployments","namespace":"shop","name":"api","patch":{"spec":{"replicas":9}},"reason":"x"}}`)
		if r["isError"] != true || !strings.Contains(r["content"].([]any)[0].(map[string]any)["text"].(string), mcp.ErrReadOnly.Error()) {
			t.Errorf("%s not refused: %v", name, r)
		}
	}
	if n := len(store.Recent()); n != 0 {
		t.Errorf("%d proposals created while read-only", n)
	}
	if len(refused) != len(refusedWant()) {
		t.Errorf("OnRefuse called %d times, want %d", len(refused), len(refusedWant()))
	}
	for _, e := range *entries {
		if strings.Contains(e.Action, "propose") {
			t.Errorf("a write tool's handler ran: %+v", e)
		}
	}
}

func refusedWant() []string {
	var out []string
	for n, a := range toolAccess {
		if a == mcp.AccessWrite {
			out = append(out, n)
		}
	}
	return out
}
