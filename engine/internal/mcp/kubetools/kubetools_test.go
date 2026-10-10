package kubetools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
)

type snapCall struct {
	cluster, gvr, selector, mode string
	namespaces                   []string
}

type fakeSource struct {
	clusters []clusters.Cluster
	objs     map[string][]map[string]any // gvr -> objects
	calls    []snapCall
}

func (f *fakeSource) Clusters() []clusters.Cluster { return f.clusters }

func (f *fakeSource) Snapshot(_ context.Context, cluster, gvr string, namespaces []string, selector, mode string) ([]map[string]any, error) {
	f.calls = append(f.calls, snapCall{cluster, gvr, selector, mode, namespaces})
	var out []map[string]any
	for _, o := range f.objs[gvr] {
		ns, _ := o["metadata"].(map[string]any)["namespace"].(string)
		if len(namespaces) > 0 && !contains(namespaces, ns) {
			continue
		}
		out = append(out, o)
	}
	return out, nil
}

func pod(ns, name, phase string, ready bool, restarts int) map[string]any {
	return map[string]any{
		"metadata": map[string]any{"name": name, "namespace": ns, "creationTimestamp": time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)},
		"spec":     map[string]any{"nodeName": "node-1", "containers": []any{map[string]any{"name": "app"}}},
		"status": map[string]any{
			"phase":             phase,
			"containerStatuses": []any{map[string]any{"name": "app", "ready": ready, "restartCount": float64(restarts)}},
		},
	}
}

type setup struct {
	src     *fakeSource
	scope   Scope
	entries []audit.Entry
	reg     *mcp.Registry
}

func newSetup() *setup {
	s := &setup{
		src: &fakeSource{
			clusters: []clusters.Cluster{
				{ID: "kind-dev", Context: "kind-dev", Status: clusters.StatusReachable, Version: "v1.31.0"},
				{ID: "prod", Context: "arn:aws:eks:eu-west-1:1:cluster/prod", Status: clusters.StatusReachable},
			},
			objs: map[string][]map[string]any{
				"v1/pods": {pod("shop", "web-1", "Running", true, 0), pod("shop", "web-2", "Running", false, 7), pod("ops", "agent", "Pending", false, 0)},
			},
		},
		scope: Scope{Clusters: map[string][]string{"kind-dev": nil}},
	}
	s.reg = mcp.NewRegistry()
	Register(s.reg, Deps{
		Source: s.src,
		Scope:  func() Scope { return s.scope },
		Audit:  func(e audit.Entry) { s.entries = append(s.entries, e) },
	})
	return s
}

func (s *setup) call(t *testing.T, tool, args string) (mcp.Result, error) {
	t.Helper()
	tl, ok := lookup(s.reg, tool)
	if !ok {
		t.Fatalf("no tool %q", tool)
	}
	return tl.Handler(context.Background(), json.RawMessage(args), mcp.CallInfo{Tool: tool, ClientName: "claude-desktop", ClientVersion: "1.0", RequestID: "7"})
}

func text(r mcp.Result) string {
	var b strings.Builder
	for _, c := range r.Content {
		b.WriteString(c.Text)
	}
	return b.String()
}

func TestListClustersShowsOnlyClustersInScope(t *testing.T) {
	s := newSetup()
	r, err := s.call(t, "list_clusters", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text(r), "kind-dev") || strings.Contains(text(r), "prod") {
		t.Errorf("list_clusters = %s", text(r))
	}
}

func TestListResourcesRendersCompactPodRows(t *testing.T) {
	s := newSetup()
	r, err := s.call(t, "list_resources", `{"cluster":"kind-dev","kind":"pods","namespace":"shop"}`)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Kind  string           `json:"kind"`
		Rows  []map[string]any `json:"rows"`
		Total int              `json:"total"`
	}
	if err := json.Unmarshal([]byte(text(r)), &out); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, text(r))
	}
	if out.Total != 2 || len(out.Rows) != 2 {
		t.Fatalf("rows = %+v", out)
	}
	row := out.Rows[1]
	if row["name"] != "web-2" || row["ready"] != "0/1" || row["restarts"] != float64(7) || row["phase"] != "Running" || row["node"] != "node-1" || row["age"] != "2h" {
		t.Errorf("row = %v", row)
	}
	if _, ok := row["spec"]; ok {
		t.Error("rows, never whole objects")
	}
	if c := s.src.calls[0]; c.gvr != "v1/pods" || c.mode != "full" || len(c.namespaces) != 1 || c.namespaces[0] != "shop" {
		t.Errorf("snapshot call = %+v", c)
	}
}

func TestScopeIsEnforcedOnEveryCall(t *testing.T) {
	s := newSetup()
	if _, err := s.call(t, "list_resources", `{"cluster":"prod","kind":"pods"}`); err == nil || !strings.Contains(err.Error(), "not in Kubebay's MCP scope") {
		t.Errorf("out-of-scope cluster: %v", err)
	}
	s.scope = Scope{Clusters: map[string][]string{"kind-dev": {"shop"}}}
	if _, err := s.call(t, "list_resources", `{"cluster":"kind-dev","kind":"pods","namespace":"ops"}`); err == nil {
		t.Error("namespace outside scope must be refused")
	}
	r, err := s.call(t, "list_resources", `{"cluster":"kind-dev","kind":"pods"}`)
	if err != nil || strings.Contains(text(r), "agent") || !strings.Contains(text(r), "web-1") {
		t.Errorf("no namespace given: only the scoped ones: %v %s", err, text(r))
	}
	if _, err := s.call(t, "list_resources", `{"cluster":"kind-dev","kind":"nodes"}`); err == nil {
		t.Error("cluster-scoped kinds need cluster-wide scope")
	}
}

func TestSecretsAreNotAKind(t *testing.T) {
	s := newSetup()
	_, err := s.call(t, "list_resources", `{"cluster":"kind-dev","kind":"secrets"}`)
	if err == nil || !mcp.IsArgError(err) || !strings.Contains(err.Error(), "pods") {
		t.Errorf("secrets: %v", err)
	}
}

func TestConfigMapsAreListedByNameOnly(t *testing.T) {
	s := newSetup()
	if _, err := s.call(t, "list_resources", `{"cluster":"kind-dev","kind":"configmaps"}`); err != nil {
		t.Fatal(err)
	}
	if c := s.src.calls[0]; c.mode != "metadata" {
		t.Errorf("configmaps must stream metadata only, never data: %+v", c)
	}
}

func TestListIsCappedAndSaysSo(t *testing.T) {
	s := newSetup()
	r, err := s.call(t, "list_resources", `{"cluster":"kind-dev","kind":"pods","limit":1}`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text(r), `"truncated":true`) || !strings.Contains(text(r), `"total":3`) {
		t.Errorf("capped list: %s", text(r))
	}
}

func TestEveryCallIsAudited(t *testing.T) {
	s := newSetup()
	_, _ = s.call(t, "list_resources", `{"cluster":"kind-dev","kind":"pods","namespace":"shop"}`)
	_, _ = s.call(t, "list_resources", `{"cluster":"prod","kind":"pods"}`)
	if len(s.entries) != 2 {
		t.Fatalf("entries = %+v", s.entries)
	}
	e := s.entries[0]
	if e.Source != "mcp" || e.Action != "mcp:list_resources" || e.Cluster != "kind-dev" || e.Namespace != "shop" || !strings.Contains(e.UserAgent, "claude-desktop") || !strings.Contains(e.Detail, "pods") || e.Outcome != "" {
		t.Errorf("entry = %+v", e)
	}
	if s.entries[1].Outcome != "error" {
		t.Errorf("a refused call is audited as an error: %+v", s.entries[1])
	}
}

func lookup(r *mcp.Registry, name string) (mcp.Tool, bool) { return r.Get(name) }
