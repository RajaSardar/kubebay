package kubetools

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func (f *fakeSource) Get(_ context.Context, cluster, gvr, ns, name string) (map[string]any, error) {
	f.calls = append(f.calls, snapCall{cluster: cluster, gvr: gvr, namespaces: []string{ns}, selector: "get:" + name})
	for _, o := range f.objs[gvr] {
		m := o["metadata"].(map[string]any)
		if m["name"] == name && (ns == "" || m["namespace"] == ns) {
			return o, nil
		}
	}
	return nil, fmt.Errorf("%s %s/%s not found", gvr, ns, name)
}

func (f *fakeSource) Logs(_ context.Context, cluster, ns, pod string, opt LogOptions) (string, error) {
	f.logCalls = append(f.logCalls, logCall{cluster, ns, pod, opt})
	if opt.Previous {
		return "panic: nil map\npanic: nil map\npanic: nil map\nexit 2\n", nil
	}
	if f.currentLogs != "" {
		return f.currentLogs, nil
	}
	if opt.Container == "leaky" {
		return "connecting to postgres://app:hunter2@db/shop\nAuthorization: Bearer abc123def456ghi789\n", nil
	}
	return "listening on :8080\n", nil
}

type logCall struct {
	cluster, ns, pod string
	opt              LogOptions
}

func crashingPod() map[string]any {
	return map[string]any{
		"kind": "Pod",
		"metadata": map[string]any{
			"name": "api-7d9-x", "namespace": "shop", "creationTimestamp": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
			"ownerReferences": []any{map[string]any{"kind": "ReplicaSet", "name": "api-7d9", "controller": true}},
			"annotations":     map[string]any{"kubectl.kubernetes.io/last-applied-configuration": `{"spec":{"containers":[{"env":[{"name":"DB_PASSWORD","value":"hunter2"}]}]}}`, "team": "payments"},
			"managedFields":   []any{map[string]any{"manager": "kubectl"}},
		},
		"spec": map[string]any{
			"nodeName": "node-1",
			"containers": []any{map[string]any{
				"name": "api", "image": "ghcr.io/acme/api:1.4",
				"env": []any{
					map[string]any{"name": "DB_PASSWORD", "value": "hunter2"},
					map[string]any{"name": "TOKEN", "valueFrom": map[string]any{"secretKeyRef": map[string]any{"name": "api", "key": "token"}}},
				},
			}},
		},
		"status": map[string]any{
			"phase": "Running",
			"conditions": []any{
				map[string]any{"type": "Ready", "status": "False", "reason": "ContainersNotReady"},
			},
			"containerStatuses": []any{map[string]any{
				"name": "api", "ready": false, "restartCount": float64(12), "image": "ghcr.io/acme/api:1.4",
				"state":     map[string]any{"waiting": map[string]any{"reason": "CrashLoopBackOff", "message": "back-off 5m0s"}},
				"lastState": map[string]any{"terminated": map[string]any{"reason": "Error", "exitCode": float64(2), "finishedAt": "2026-10-10T01:00:00Z"}},
			}},
		},
	}
}

func event(ns, kind, name, typ, reason, msg string, count int) map[string]any {
	return map[string]any{
		"metadata":       map[string]any{"name": name + "." + reason, "namespace": ns},
		"involvedObject": map[string]any{"kind": kind, "name": name, "namespace": ns},
		"type":           typ, "reason": reason, "message": msg, "count": float64(count),
		"lastTimestamp": time.Now().Add(-time.Minute).UTC().Format(time.RFC3339),
	}
}

func inspectSetup() *setup {
	s := newSetup()
	s.src.objs["v1/pods"] = append(s.src.objs["v1/pods"], crashingPod())
	s.src.objs["apps/v1/replicasets"] = []map[string]any{{
		"metadata": map[string]any{"name": "api-7d9", "namespace": "shop", "ownerReferences": []any{map[string]any{"kind": "Deployment", "name": "api", "controller": true}}},
	}}
	s.src.objs["v1/events"] = []map[string]any{
		event("shop", "Pod", "api-7d9-x", "Warning", "BackOff", "Back-off restarting failed container", 40),
		event("shop", "Pod", "api-7d9-x", "Normal", "Pulled", "Container image already present", 12),
		event("shop", "Pod", "web-1", "Warning", "Unhealthy", "Readiness probe failed", 3),
		event("ops", "Pod", "agent", "Warning", "FailedScheduling", "0/3 nodes are available", 9),
	}
	return s
}

func TestDescribeAPodIsTheCrashloopAnswer(t *testing.T) {
	s := inspectSetup()
	r, err := s.call(t, "describe_resource", `{"cluster":"kind-dev","kind":"pods","namespace":"shop","name":"api-7d9-x"}`)
	if err != nil {
		t.Fatal(err)
	}
	out := text(r)
	for _, want := range []string{
		"CrashLoopBackOff", `"restarts":12`, `"exitCode":2`, `"reason":"Error"`, "ghcr.io/acme/api:1.4",
		"ReplicaSet/api-7d9", "Deployment/api", "BackOff", "ContainersNotReady",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("describe should mention %s:\n%s", want, out)
		}
	}
	if strings.Contains(out, "hunter2") {
		t.Errorf("env values must be redacted:\n%s", out)
	}
	if !strings.Contains(out, "DB_PASSWORD") || !strings.Contains(out, "secretKeyRef") {
		t.Errorf("env names and where a value comes from stay:\n%s", out)
	}
	if strings.Index(out, "BackOff") > strings.Index(out, "Pulled") && strings.Contains(out, "Pulled") {
		t.Errorf("warnings come first:\n%s", out)
	}
}

func TestGetLogsDedupesAndPrefersWhatTheModelAskedFor(t *testing.T) {
	s := inspectSetup()
	r, err := s.call(t, "get_logs", `{"cluster":"kind-dev","namespace":"shop","pod":"api-7d9-x","previous":true}`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text(r), "panic: nil map  (×3)") || strings.Count(text(r), "panic: nil map") != 1 {
		t.Errorf("repeated lines collapse with a count:\n%s", text(r))
	}
	c := s.src.logCalls[0]
	if !c.opt.Previous || c.opt.TailLines != 200 || c.opt.LimitBytes != 40<<10 {
		t.Errorf("log call = %+v", c)
	}
	if _, err := s.call(t, "get_logs", `{"cluster":"kind-dev","namespace":"shop","pod":"api-7d9-x","tailLines":100000}`); err != nil {
		t.Fatal(err)
	}
	if s.src.logCalls[1].opt.TailLines != 1000 {
		t.Errorf("tailLines capped: %+v", s.src.logCalls[1].opt)
	}
}

// Logs are free text: credentials printed by the app are masked before an
// assistant sees them.
func TestGetLogsMasksCredentials(t *testing.T) {
	s := inspectSetup()
	r, err := s.call(t, "get_logs", `{"cluster":"kind-dev","namespace":"shop","pod":"api-7d9-x","container":"leaky"}`)
	if err != nil {
		t.Fatal(err)
	}
	out := text(r)
	if strings.Contains(out, "hunter2") || strings.Contains(out, "abc123def456ghi789") || !strings.Contains(out, "2 values masked") {
		t.Errorf("logs:\n%s", out)
	}
}

func TestListEventsAggregatesWarningsInScope(t *testing.T) {
	s := inspectSetup()
	s.scope = Scope{Clusters: map[string][]string{"kind-dev": {"shop"}}}
	r, err := s.call(t, "list_events", `{"cluster":"kind-dev"}`)
	if err != nil {
		t.Fatal(err)
	}
	out := text(r)
	if !strings.Contains(out, "BackOff") || !strings.Contains(out, `"count":40`) || strings.Contains(out, "FailedScheduling") || strings.Contains(out, "Pulled") {
		t.Errorf("warnings in scope only, with counts:\n%s", out)
	}
	if !strings.Contains(out, `"object":"Pod/api-7d9-x"`) {
		t.Errorf("each event names its object:\n%s", out)
	}
	r, _ = s.call(t, "list_events", `{"cluster":"kind-dev","warningsOnly":false}`)
	if !strings.Contains(text(r), "Pulled") {
		t.Errorf("warningsOnly:false includes Normal events:\n%s", text(r))
	}
}

func TestGetManifestStripsWhatLeaksAndWhatIsNoise(t *testing.T) {
	s := inspectSetup()
	r, err := s.call(t, "get_manifest", `{"cluster":"kind-dev","kind":"pods","namespace":"shop","name":"api-7d9-x"}`)
	if err != nil {
		t.Fatal(err)
	}
	out := text(r)
	if strings.Contains(out, "hunter2") || strings.Contains(out, "last-applied-configuration") || strings.Contains(out, "managedFields") {
		t.Errorf("manifest leaks or is noisy:\n%s", out)
	}
	if !strings.Contains(out, "team: payments") || !strings.Contains(out, "DB_PASSWORD") || !strings.Contains(out, "image: ghcr.io/acme/api:1.4") {
		t.Errorf("manifest lost real content:\n%s", out)
	}
	if _, err := s.call(t, "get_manifest", `{"cluster":"kind-dev","kind":"configmaps","namespace":"shop","name":"x"}`); err == nil {
		t.Error("ConfigMap contents are never shown")
	}
	if _, err := s.call(t, "get_manifest", `{"cluster":"kind-dev","kind":"secrets","namespace":"shop","name":"x"}`); err == nil {
		t.Error("Secrets are never shown")
	}
}

func TestClusterHealthSummarisesWhatNeedsAttention(t *testing.T) {
	s := inspectSetup()
	s.src.objs["v1/nodes"] = []map[string]any{
		{"metadata": map[string]any{"name": "n1"}, "status": map[string]any{"conditions": []any{map[string]any{"type": "Ready", "status": "True"}}}},
		{"metadata": map[string]any{"name": "n2"}, "status": map[string]any{"conditions": []any{map[string]any{"type": "Ready", "status": "False"}}}},
	}
	r, err := s.call(t, "get_cluster_health", `{"cluster":"kind-dev"}`)
	if err != nil {
		t.Fatal(err)
	}
	out := text(r)
	for _, want := range []string{`"nodesReady":1`, `"nodesTotal":2`, "api-7d9-x", "CrashLoopBackOff", "agent", "BackOff"} {
		if !strings.Contains(out, want) {
			t.Errorf("health should include %s:\n%s", want, out)
		}
	}
	// A namespace-scoped cluster has no business seeing its nodes.
	s.scope = Scope{Clusters: map[string][]string{"kind-dev": {"shop"}}}
	r, err = s.call(t, "get_cluster_health", `{"cluster":"kind-dev"}`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text(r), "nodesTotal") || strings.Contains(text(r), "agent") {
		t.Errorf("namespace-scoped health:\n%s", text(r))
	}
}

func TestInspectionToolsEnforceScope(t *testing.T) {
	s := inspectSetup()
	s.scope = Scope{Clusters: map[string][]string{"kind-dev": {"ops"}}}
	for _, call := range []struct{ tool, args string }{
		{"describe_resource", `{"cluster":"kind-dev","kind":"pods","namespace":"shop","name":"api-7d9-x"}`},
		{"get_logs", `{"cluster":"kind-dev","namespace":"shop","pod":"api-7d9-x"}`},
		{"get_manifest", `{"cluster":"kind-dev","kind":"pods","namespace":"shop","name":"api-7d9-x"}`},
		{"list_events", `{"cluster":"kind-dev","namespace":"shop"}`},
		{"get_cluster_health", `{"cluster":"prod"}`},
	} {
		if _, err := s.call(t, call.tool, call.args); err == nil {
			t.Errorf("%s out of scope must be refused", call.tool)
		}
	}
	if len(s.src.logCalls) != 0 {
		t.Error("no logs fetched outside scope")
	}
}
