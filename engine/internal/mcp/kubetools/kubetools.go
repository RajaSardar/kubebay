// Package kubetools is the cluster-facing half of Kubebay's MCP server
// (backlog #5): read-only tools over the clusters the user put in scope.
// Every answer is compact rows, never whole objects, and Secrets are not a
// kind any tool can list.
package kubetools

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/mcp"
	"github.com/RajaSardar/kubebay/engine/internal/mcp/proposals"
)

// Source is where the tools read from: the cluster list, and a one-shot
// snapshot of a resource from the engine's warm informer cache.
type Source interface {
	Clusters() []clusters.Cluster
	Snapshot(ctx context.Context, cluster, gvr string, namespaces []string, selector, mode string) ([]map[string]any, error)
}

// Scope is what the user allowed: cluster ID -> namespaces (none = all).
type Scope struct {
	Clusters map[string][]string `json:"clusters"`
}

// Deps wires the tools to the engine.
type Deps struct {
	Source Source
	Scope  func() Scope
	Audit  func(audit.Entry)
	// Proposals holds propose_change's proposals (phase 2); nil leaves the
	// write tools out entirely.
	Proposals *proposals.Store
	// Writes reports whether the user allowed assistants to propose changes.
	Writes func() bool
}

// kindDef is one listable kind. Secrets are deliberately absent.
type kindDef struct {
	gvr           string
	mode          string // "full" or "metadata"
	clusterScoped bool
	row           func(o map[string]any) map[string]any
}

var kinds = map[string]kindDef{
	"pods":                   {gvr: "v1/pods", mode: "full", row: podRow},
	"deployments":            {gvr: "apps/v1/deployments", mode: "full", row: replicasRow},
	"statefulsets":           {gvr: "apps/v1/statefulsets", mode: "full", row: replicasRow},
	"daemonsets":             {gvr: "apps/v1/daemonsets", mode: "full", row: daemonSetRow},
	"replicasets":            {gvr: "apps/v1/replicasets", mode: "full", row: replicasRow},
	"jobs":                   {gvr: "batch/v1/jobs", mode: "full", row: jobRow},
	"cronjobs":               {gvr: "batch/v1/cronjobs", mode: "full", row: cronJobRow},
	"services":               {gvr: "v1/services", mode: "full", row: serviceRow},
	"ingresses":              {gvr: "networking.k8s.io/v1/ingresses", mode: "full", row: ingressRow},
	"persistentvolumeclaims": {gvr: "v1/persistentvolumeclaims", mode: "full", row: pvcRow},
	// ConfigMaps by name only: their data can hold anything.
	"configmaps": {gvr: "v1/configmaps", mode: "metadata", row: metaRow},
	"nodes":      {gvr: "v1/nodes", mode: "full", clusterScoped: true, row: nodeRow},
	"namespaces": {gvr: "v1/namespaces", mode: "metadata", clusterScoped: true, row: metaRow},
}

func kindNames() []string {
	out := make([]string, 0, len(kinds))
	for k := range kinds {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

const (
	defaultLimit = 200
	maxLimit     = 500
)

// Register adds the tools to reg.
func Register(reg *mcp.Registry, d Deps) {
	t := &tools{d: d}
	reg.Add(mcp.Tool{
		Name:        "list_clusters",
		Title:       "List clusters",
		Description: "Lists the Kubernetes clusters Kubebay's user has allowed this assistant to read, with each cluster's reachability and version. Every other tool needs one of these cluster IDs.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
		Handler:     t.audited(t.listClusters),
	})
	schema := fmt.Sprintf(`{"type":"object","properties":{`+
		`"cluster":{"type":"string","description":"Cluster ID from list_clusters."},`+
		`"kind":{"type":"string","enum":%s},`+
		`"namespace":{"type":"string","description":"Only this namespace. Omit for every namespace in scope."},`+
		`"labelSelector":{"type":"string","description":"Kubernetes label selector, e.g. app=web."},`+
		`"limit":{"type":"integer","minimum":1,"maximum":%d,"default":%d}},`+
		`"required":["cluster","kind"],"additionalProperties":false}`, mustJSON(kindNames()), maxLimit, defaultLimit)
	reg.Add(mcp.Tool{
		Name:        "list_resources",
		Title:       "List resources",
		Description: "Lists resources of one kind as compact rows (status, readiness, restarts, age), not full objects. Secrets are never listed; ConfigMaps by name only.",
		InputSchema: json.RawMessage(schema),
		Handler:     t.audited(t.listResources),
	})
	registerInspection(reg, t)
	if d.Proposals != nil {
		registerProposals(reg, t)
	}
}

type tools struct{ d Deps }

// call carries what the audit entry records about one tool call.
type call struct {
	cluster, namespace, detail string
	info                       mcp.CallInfo
}

type handler func(ctx context.Context, args json.RawMessage, c *call) (mcp.Result, error)

// audited records every call, reads included, success or not.
func (t *tools) audited(h handler) mcp.ToolHandler {
	return func(ctx context.Context, args json.RawMessage, info mcp.CallInfo) (mcp.Result, error) {
		c := &call{info: info}
		res, err := h(ctx, args, c)
		if t.d.Audit != nil {
			e := audit.Entry{
				Source:    "mcp",
				Action:    "mcp:" + info.Tool,
				Cluster:   c.cluster,
				Namespace: c.namespace,
				Detail:    strings.TrimSpace(fmt.Sprintf("%s request=%s", c.detail, info.RequestID)),
				UserAgent: strings.TrimSpace(info.ClientName + " " + info.ClientVersion),
			}
			if err != nil {
				e.Outcome = "error"
				e.Detail += " error=" + err.Error()
			}
			t.d.Audit(e)
		}
		return res, err
	}
}

func (t *tools) scope() Scope {
	if t.d.Scope == nil {
		return Scope{}
	}
	return t.d.Scope()
}

// allowed returns the namespaces the user allowed in cluster (nil = all),
// or an error when the cluster isn't in scope at all.
func (t *tools) allowed(cluster string) ([]string, error) {
	ns, ok := t.scope().Clusters[cluster]
	if !ok {
		return nil, fmt.Errorf("cluster %q is not in Kubebay's MCP scope; list_clusters shows the ones that are", cluster)
	}
	return ns, nil
}

func (t *tools) listClusters(_ context.Context, _ json.RawMessage, c *call) (mcp.Result, error) {
	scope := t.scope()
	type row struct {
		ID         string   `json:"id"`
		Context    string   `json:"context"`
		Status     string   `json:"status"`
		Version    string   `json:"version,omitempty"`
		Namespaces []string `json:"namespaces,omitempty"`
	}
	rows := []row{}
	for _, cl := range t.d.Source.Clusters() {
		ns, ok := scope.Clusters[cl.ID]
		if !ok {
			continue
		}
		rows = append(rows, row{ID: cl.ID, Context: cl.Context, Status: string(cl.Status), Version: cl.Version, Namespaces: ns})
	}
	c.detail = fmt.Sprintf("clusters=%d", len(rows))
	return jsonResult(map[string]any{"clusters": rows, "note": "namespaces, when present, are the only ones this assistant may read in that cluster"})
}

type listArgs struct {
	Cluster       string `json:"cluster"`
	Kind          string `json:"kind"`
	Namespace     string `json:"namespace"`
	LabelSelector string `json:"labelSelector"`
	Limit         int    `json:"limit"`
}

func (t *tools) listResources(ctx context.Context, raw json.RawMessage, c *call) (mcp.Result, error) {
	var a listArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return mcp.Result{}, mcp.ArgError("invalid arguments: " + err.Error())
	}
	c.cluster, c.namespace = a.Cluster, a.Namespace
	c.detail = fmt.Sprintf("kind=%s selector=%q", a.Kind, a.LabelSelector)
	if a.Cluster == "" {
		return mcp.Result{}, mcp.ArgError("cluster is required")
	}
	def, ok := kinds[a.Kind]
	if !ok {
		return mcp.Result{}, mcp.ArgError(fmt.Sprintf("kind must be one of %s (Secrets are never listed)", strings.Join(kindNames(), ", ")))
	}
	limit := a.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	allowedNS, err := t.allowed(a.Cluster)
	if err != nil {
		return mcp.Result{}, err
	}
	var namespaces []string
	switch {
	case def.clusterScoped && len(allowedNS) > 0 && a.Kind != "namespaces":
		return mcp.Result{}, fmt.Errorf("%s are cluster-wide, and this cluster's MCP scope is limited to namespaces %s", a.Kind, strings.Join(allowedNS, ", "))
	case def.clusterScoped:
		// namespaces: listed cluster-wide, filtered below when scope is limited.
	case a.Namespace != "":
		if len(allowedNS) > 0 && !contains(allowedNS, a.Namespace) {
			return mcp.Result{}, fmt.Errorf("namespace %q is not in this cluster's MCP scope (%s)", a.Namespace, strings.Join(allowedNS, ", "))
		}
		namespaces = []string{a.Namespace}
	default:
		namespaces = allowedNS
	}
	objs, err := t.d.Source.Snapshot(ctx, a.Cluster, def.gvr, namespaces, a.LabelSelector, def.mode)
	if err != nil {
		return mcp.Result{}, err
	}
	rows := make([]map[string]any, 0, len(objs))
	for _, o := range objs {
		if a.Kind == "namespaces" && len(allowedNS) > 0 && !contains(allowedNS, str(meta(o), "name")) {
			continue
		}
		rows = append(rows, def.row(o))
	}
	sort.Slice(rows, func(i, j int) bool {
		ki := fmt.Sprint(rows[i]["namespace"], "/", rows[i]["name"])
		kj := fmt.Sprint(rows[j]["namespace"], "/", rows[j]["name"])
		return ki < kj
	})
	total := len(rows)
	truncated := total > limit
	if truncated {
		rows = rows[:limit]
	}
	return jsonResult(map[string]any{"cluster": a.Cluster, "kind": a.Kind, "total": total, "truncated": truncated, "rows": rows})
}

func jsonResult(v any) (mcp.Result, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return mcp.Result{}, err
	}
	return mcp.Result{Content: []mcp.Content{{Type: "text", Text: string(b)}}}, nil
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// --- rows ---

func meta(o map[string]any) map[string]any { m, _ := o["metadata"].(map[string]any); return m }
func spec(o map[string]any) map[string]any { m, _ := o["spec"].(map[string]any); return m }
func status(o map[string]any) map[string]any {
	m, _ := o["status"].(map[string]any)
	return m
}

func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func num(m map[string]any, k string) int {
	switch v := m[k].(type) {
	case float64:
		return int(v)
	case int64:
		return int(v)
	case int:
		return v
	}
	return 0
}

func age(o map[string]any) string {
	ts, err := time.Parse(time.RFC3339, str(meta(o), "creationTimestamp"))
	if err != nil {
		return ""
	}
	d := time.Since(ts)
	switch {
	case d >= 48*time.Hour:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	case d >= time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	case d >= time.Minute:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	return fmt.Sprintf("%ds", int(d.Seconds()))
}

func base(o map[string]any) map[string]any {
	r := map[string]any{"name": str(meta(o), "name"), "age": age(o)}
	if ns := str(meta(o), "namespace"); ns != "" {
		r["namespace"] = ns
	}
	return r
}

func metaRow(o map[string]any) map[string]any { return base(o) }

func podRow(o map[string]any) map[string]any {
	r := base(o)
	st := status(o)
	r["phase"] = str(st, "phase")
	ready, total, restarts := 0, 0, 0
	reason := ""
	for _, cs := range asList(st["containerStatuses"]) {
		c, _ := cs.(map[string]any)
		total++
		if b, _ := c["ready"].(bool); b {
			ready++
		}
		restarts += num(c, "restartCount")
		if w, _ := c["state"].(map[string]any); w != nil {
			if waiting, _ := w["waiting"].(map[string]any); waiting != nil && reason == "" {
				reason = str(waiting, "reason")
			}
		}
	}
	if total == 0 {
		total = len(asList(spec(o)["containers"]))
	}
	r["ready"] = fmt.Sprintf("%d/%d", ready, total)
	r["restarts"] = restarts
	if n := str(spec(o), "nodeName"); n != "" {
		r["node"] = n
	}
	if reason != "" {
		r["reason"] = reason
	}
	return r
}

func replicasRow(o map[string]any) map[string]any {
	r := base(o)
	st := status(o)
	desired := num(spec(o), "replicas")
	r["ready"] = fmt.Sprintf("%d/%d", num(st, "readyReplicas"), desired)
	if u, ok := st["updatedReplicas"]; ok {
		r["updated"] = u
	}
	return r
}

func daemonSetRow(o map[string]any) map[string]any {
	r := base(o)
	st := status(o)
	r["ready"] = fmt.Sprintf("%d/%d", num(st, "numberReady"), num(st, "desiredNumberScheduled"))
	return r
}

func jobRow(o map[string]any) map[string]any {
	r := base(o)
	st := status(o)
	r["succeeded"] = num(st, "succeeded")
	r["failed"] = num(st, "failed")
	r["active"] = num(st, "active")
	return r
}

func cronJobRow(o map[string]any) map[string]any {
	r := base(o)
	r["schedule"] = str(spec(o), "schedule")
	if s, ok := spec(o)["suspend"].(bool); ok && s {
		r["suspended"] = true
	}
	if l := str(status(o), "lastScheduleTime"); l != "" {
		r["lastSchedule"] = l
	}
	return r
}

func serviceRow(o map[string]any) map[string]any {
	r := base(o)
	s := spec(o)
	r["type"] = str(s, "type")
	if ip := str(s, "clusterIP"); ip != "" {
		r["clusterIP"] = ip
	}
	var ports []string
	for _, p := range asList(s["ports"]) {
		pm, _ := p.(map[string]any)
		ports = append(ports, fmt.Sprintf("%d/%s", num(pm, "port"), str(pm, "protocol")))
	}
	if len(ports) > 0 {
		r["ports"] = strings.Join(ports, ",")
	}
	return r
}

func ingressRow(o map[string]any) map[string]any {
	r := base(o)
	var hosts []string
	for _, rule := range asList(spec(o)["rules"]) {
		rm, _ := rule.(map[string]any)
		if h := str(rm, "host"); h != "" {
			hosts = append(hosts, h)
		}
	}
	if len(hosts) > 0 {
		r["hosts"] = strings.Join(hosts, ",")
	}
	return r
}

func pvcRow(o map[string]any) map[string]any {
	r := base(o)
	r["phase"] = str(status(o), "phase")
	if cap, _ := status(o)["capacity"].(map[string]any); cap != nil {
		r["capacity"] = str(cap, "storage")
	}
	if sc := str(spec(o), "storageClassName"); sc != "" {
		r["storageClass"] = sc
	}
	return r
}

func nodeRow(o map[string]any) map[string]any {
	r := base(o)
	ready := "Unknown"
	for _, c := range asList(status(o)["conditions"]) {
		cm, _ := c.(map[string]any)
		if str(cm, "type") == "Ready" {
			ready = str(cm, "status")
		}
	}
	r["ready"] = ready
	if ni, _ := status(o)["nodeInfo"].(map[string]any); ni != nil {
		r["kubelet"] = str(ni, "kubeletVersion")
	}
	if u, ok := spec(o)["unschedulable"].(bool); ok && u {
		r["cordoned"] = true
	}
	return r
}

func asList(v any) []any { l, _ := v.([]any); return l }
