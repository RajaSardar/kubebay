package kubetools

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"sigs.k8s.io/yaml"

	"github.com/RajaSardar/kubebay/engine/internal/mcp"
)

// LogOptions bounds a log read. LimitBytes is enforced by the API server.
type LogOptions struct {
	Container  string
	Previous   bool
	TailLines  int
	LimitBytes int
}

// Inspector is the part of Source the inspection tools need beyond lists:
// one object, and a pod's logs.
type Inspector interface {
	Get(ctx context.Context, cluster, gvr, ns, name string) (map[string]any, error)
	Logs(ctx context.Context, cluster, ns, pod string, opt LogOptions) (string, error)
}

const (
	defaultTail = 200
	maxTail     = 1000
	logBytes    = 40 << 10
	// manifestBytes caps get_manifest; a big CRD can be megabytes.
	manifestBytes = 40 << 10
	eventsShown   = 10
)

// The kinds describe_resource and get_manifest open: list_resources' kinds
// minus ConfigMaps, whose contents can hold anything.
func inspectable(kind string) (kindDef, bool) {
	if kind == "configmaps" {
		return kindDef{}, false
	}
	d, ok := kinds[kind]
	return d, ok
}

func inspectKinds() []string {
	var out []string
	for _, k := range kindNames() {
		if _, ok := inspectable(k); ok {
			out = append(out, k)
		}
	}
	return out
}

func registerInspection(reg *mcp.Registry, t *tools) {
	objSchema := fmt.Sprintf(`{"type":"object","properties":{`+
		`"cluster":{"type":"string"},"kind":{"type":"string","enum":%s},`+
		`"namespace":{"type":"string","description":"Required for namespaced kinds."},"name":{"type":"string"}},`+
		`"required":["cluster","kind","name"],"additionalProperties":false}`, mustJSON(inspectKinds()))
	reg.Add(mcp.Tool{
		Name:  "describe_resource",
		Title: "Describe a resource",
		Description: "Why is this resource unhealthy? For a pod: each container's image, state, restarts and last termination (reason, exit code), " +
			"conditions, the owner chain up to its Deployment, and its latest events, warnings first. Env values are redacted.",
		InputSchema: json.RawMessage(objSchema),
		Handler:     t.audited(t.describe),
	})
	reg.Add(mcp.Tool{
		Name:  "get_logs",
		Title: "Get pod logs",
		Description: "Recent log lines of one pod container, repeated lines collapsed with a count, capped at 40KB. " +
			"For a CrashLoopBackOff, set previous:true: the useful lines are in the container that died, not the one restarting.",
		InputSchema: json.RawMessage(fmt.Sprintf(`{"type":"object","properties":{`+
			`"cluster":{"type":"string"},"namespace":{"type":"string"},"pod":{"type":"string"},`+
			`"container":{"type":"string","description":"Needed when the pod has several containers."},`+
			`"previous":{"type":"boolean","default":false},`+
			`"tailLines":{"type":"integer","minimum":1,"maximum":%d,"default":%d}},`+
			`"required":["cluster","namespace","pod"],"additionalProperties":false}`, maxTail, defaultTail)),
		Handler: t.audited(t.logs),
	})
	reg.Add(mcp.Tool{
		Name:        "list_events",
		Title:       "List events",
		Description: "Kubernetes events grouped by object and reason, with counts and the latest message; warnings only unless warningsOnly is false.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{` +
			`"cluster":{"type":"string"},"namespace":{"type":"string","description":"Omit for every namespace in scope."},` +
			`"warningsOnly":{"type":"boolean","default":true},"limit":{"type":"integer","minimum":1,"maximum":200,"default":50}},` +
			`"required":["cluster"],"additionalProperties":false}`),
		Handler: t.audited(t.events),
	})
	reg.Add(mcp.Tool{
		Name:  "get_manifest",
		Title: "Get a manifest",
		Description: "The resource's YAML when the summary tools aren't enough, without managedFields or the last-applied annotation, " +
			"env values redacted, capped at 40KB. Secrets and ConfigMap contents are never available.",
		InputSchema: json.RawMessage(objSchema),
		Handler:     t.audited(t.manifest),
	})
	reg.Add(mcp.Tool{
		Name:  "get_cluster_health",
		Title: "Cluster health",
		Description: "One-call overview: node readiness, pods that aren't running or ready (with the reason), and the most frequent warning events. " +
			"Start here when asked what's wrong with a cluster.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"cluster":{"type":"string"}},"required":["cluster"],"additionalProperties":false}`),
		Handler:     t.audited(t.health),
	})
}

func (t *tools) inspector() (Inspector, error) {
	in, ok := t.d.Source.(Inspector)
	if !ok {
		return nil, fmt.Errorf("this engine can't read single objects")
	}
	return in, nil
}

type objArgs struct {
	Cluster   string `json:"cluster"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// resolve checks an object request against scope and returns its kind.
func (t *tools) resolve(raw json.RawMessage, c *call) (objArgs, kindDef, error) {
	var a objArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return a, kindDef{}, mcp.ArgError("invalid arguments: " + err.Error())
	}
	c.cluster, c.namespace = a.Cluster, a.Namespace
	c.detail = fmt.Sprintf("kind=%s name=%s", a.Kind, a.Name)
	def, ok := inspectable(a.Kind)
	if !ok {
		return a, def, mcp.ArgError(fmt.Sprintf("kind must be one of %s (Secrets and ConfigMap contents are never available)", strings.Join(inspectKinds(), ", ")))
	}
	if a.Cluster == "" || a.Name == "" {
		return a, def, mcp.ArgError("cluster and name are required")
	}
	if !def.clusterScoped && a.Namespace == "" {
		return a, def, mcp.ArgError(a.Kind + " are namespaced: namespace is required")
	}
	if err := t.checkNamespace(a.Cluster, a.Namespace, def.clusterScoped && a.Kind != "namespaces"); err != nil {
		return a, def, err
	}
	if a.Kind == "namespaces" {
		if err := t.checkNamespace(a.Cluster, a.Name, false); err != nil {
			return a, def, err
		}
	}
	return a, def, nil
}

// checkNamespace refuses a cluster out of scope, a namespace out of scope,
// and (clusterWide) anything cluster-wide in a namespace-scoped cluster.
func (t *tools) checkNamespace(cluster, ns string, clusterWide bool) error {
	allowed, err := t.allowed(cluster)
	if err != nil {
		return err
	}
	if len(allowed) == 0 {
		return nil
	}
	if clusterWide {
		return fmt.Errorf("this cluster's MCP scope is limited to namespaces %s", strings.Join(allowed, ", "))
	}
	if ns != "" && !contains(allowed, ns) {
		return fmt.Errorf("namespace %q is not in this cluster's MCP scope (%s)", ns, strings.Join(allowed, ", "))
	}
	return nil
}

func (t *tools) describe(ctx context.Context, raw json.RawMessage, c *call) (mcp.Result, error) {
	a, def, err := t.resolve(raw, c)
	if err != nil {
		return mcp.Result{}, err
	}
	in, err := t.inspector()
	if err != nil {
		return mcp.Result{}, err
	}
	o, err := in.Get(ctx, a.Cluster, def.gvr, a.Namespace, a.Name)
	if err != nil {
		return mcp.Result{}, err
	}
	out := map[string]any{"kind": a.Kind, "summary": def.row(o)}
	if conds := conditions(o); len(conds) > 0 {
		out["conditions"] = conds
	}
	if a.Kind == "pods" {
		out["containers"] = containerDetail(o)
		out["owners"] = t.ownerChain(ctx, in, a.Cluster, a.Namespace, o)
	}
	if evs, err := t.objectEvents(ctx, a.Cluster, a.Namespace, a.Name); err == nil && len(evs) > 0 {
		out["events"] = evs
	}
	return jsonResult(out)
}

func conditions(o map[string]any) []map[string]any {
	var out []map[string]any
	for _, cnd := range asList(status(o)["conditions"]) {
		cm, _ := cnd.(map[string]any)
		row := map[string]any{"type": str(cm, "type"), "status": str(cm, "status")}
		if r := str(cm, "reason"); r != "" {
			row["reason"] = r
		}
		if m := str(cm, "message"); m != "" {
			row["message"] = m
		}
		out = append(out, row)
	}
	return out
}

// containerDetail joins each container's spec (image, env names, where each
// value comes from) with its status (state, restarts, last termination).
func containerDetail(o map[string]any) []map[string]any {
	statuses := map[string]map[string]any{}
	for _, list := range []string{"containerStatuses", "initContainerStatuses"} {
		for _, cs := range asList(status(o)[list]) {
			m, _ := cs.(map[string]any)
			statuses[str(m, "name")] = m
		}
	}
	var out []map[string]any
	for _, list := range []string{"initContainers", "containers"} {
		for _, ct := range asList(spec(o)[list]) {
			cm, _ := ct.(map[string]any)
			name := str(cm, "name")
			row := map[string]any{"name": name, "image": str(cm, "image")}
			if list == "initContainers" {
				row["init"] = true
			}
			if env := redactedEnv(cm); len(env) > 0 {
				row["env"] = env
			}
			if st := statuses[name]; st != nil {
				if b, ok := st["ready"].(bool); ok {
					row["ready"] = b
				}
				row["restarts"] = num(st, "restartCount")
				if s := stateOf(st["state"]); s != nil {
					row["state"] = s
				}
				if s := stateOf(st["lastState"]); s != nil {
					row["lastState"] = s
				}
			}
			out = append(out, row)
		}
	}
	return out
}

func stateOf(v any) map[string]any {
	m, _ := v.(map[string]any)
	for _, k := range []string{"waiting", "running", "terminated"} {
		s, _ := m[k].(map[string]any)
		if s == nil {
			continue
		}
		out := map[string]any{"state": k}
		for _, f := range []string{"reason", "message", "startedAt", "finishedAt"} {
			if v := str(s, f); v != "" {
				out[f] = v
			}
		}
		if _, ok := s["exitCode"]; ok {
			out["exitCode"] = num(s, "exitCode")
		}
		return out
	}
	return nil
}

// redactedEnv keeps each variable's name and where its value comes from,
// never a literal value.
func redactedEnv(container map[string]any) []map[string]any {
	var out []map[string]any
	for _, e := range asList(container["env"]) {
		em, _ := e.(map[string]any)
		row := map[string]any{"name": str(em, "name")}
		if vf, _ := em["valueFrom"].(map[string]any); vf != nil {
			for k, ref := range vf {
				rm, _ := ref.(map[string]any)
				row["from"] = strings.TrimSpace(fmt.Sprintf("%s %s %s", k, str(rm, "name"), str(rm, "key")))
			}
		} else if _, ok := em["value"]; ok {
			row["value"] = "<redacted>"
		}
		out = append(out, row)
	}
	return out
}

// ownerChain walks controller owners: Pod → ReplicaSet → Deployment.
func (t *tools) ownerChain(ctx context.Context, in Inspector, cluster, ns string, o map[string]any) []string {
	var chain []string
	cur := o
	for depth := 0; depth < 3; depth++ {
		var owner map[string]any
		for _, ref := range asList(meta(cur)["ownerReferences"]) {
			rm, _ := ref.(map[string]any)
			if b, _ := rm["controller"].(bool); b {
				owner = rm
			}
		}
		if owner == nil {
			break
		}
		kind, name := str(owner, "kind"), str(owner, "name")
		chain = append(chain, kind+"/"+name)
		if kind != "ReplicaSet" {
			break
		}
		next, err := in.Get(ctx, cluster, "apps/v1/replicasets", ns, name)
		if err != nil {
			break
		}
		cur = next
	}
	return chain
}

type eventRow struct {
	Namespace string `json:"namespace,omitempty"`
	Object    string `json:"object"`
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Count     int    `json:"count"`
	Last      string `json:"last,omitempty"`
	Message   string `json:"message"`
	lastTime  time.Time
}

// aggregate groups events by object and reason, keeping the latest message.
func aggregate(objs []map[string]any, warningsOnly bool, match func(involved map[string]any) bool) []eventRow {
	groups := map[string]*eventRow{}
	for _, e := range objs {
		involved, _ := e["involvedObject"].(map[string]any)
		if match != nil && !match(involved) {
			continue
		}
		typ := str(e, "type")
		if warningsOnly && typ != "Warning" {
			continue
		}
		obj := str(involved, "kind") + "/" + str(involved, "name")
		ns := str(involved, "namespace")
		key := ns + "|" + obj + "|" + str(e, "reason")
		count := num(e, "count")
		if count == 0 {
			count = 1
		}
		last := str(e, "lastTimestamp")
		if last == "" {
			last = str(e, "eventTime")
		}
		lt, _ := time.Parse(time.RFC3339, last)
		g := groups[key]
		if g == nil {
			g = &eventRow{Namespace: ns, Object: obj, Type: typ, Reason: str(e, "reason")}
			groups[key] = g
		}
		g.Count += count
		if lt.After(g.lastTime) || g.Message == "" {
			g.lastTime, g.Last, g.Message = lt, last, str(e, "message")
		}
	}
	out := make([]eventRow, 0, len(groups))
	for _, g := range groups {
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Type == "Warning") != (out[j].Type == "Warning") {
			return out[i].Type == "Warning"
		}
		if !out[i].lastTime.Equal(out[j].lastTime) {
			return out[i].lastTime.After(out[j].lastTime)
		}
		return out[i].Count > out[j].Count
	})
	return out
}

func (t *tools) objectEvents(ctx context.Context, cluster, ns, name string) ([]eventRow, error) {
	var nss []string
	if ns != "" {
		nss = []string{ns}
	}
	objs, err := t.d.Source.Snapshot(ctx, cluster, "v1/events", nss, "", "full")
	if err != nil {
		return nil, err
	}
	rows := aggregate(objs, false, func(inv map[string]any) bool { return str(inv, "name") == name })
	if len(rows) > eventsShown {
		rows = rows[:eventsShown]
	}
	return rows, nil
}

type logArgs struct {
	Cluster   string `json:"cluster"`
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container"`
	Previous  bool   `json:"previous"`
	TailLines int    `json:"tailLines"`
}

func (t *tools) logs(ctx context.Context, raw json.RawMessage, c *call) (mcp.Result, error) {
	var a logArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return mcp.Result{}, mcp.ArgError("invalid arguments: " + err.Error())
	}
	c.cluster, c.namespace = a.Cluster, a.Namespace
	c.detail = fmt.Sprintf("pod=%s container=%s previous=%v", a.Pod, a.Container, a.Previous)
	if a.Cluster == "" || a.Namespace == "" || a.Pod == "" {
		return mcp.Result{}, mcp.ArgError("cluster, namespace and pod are required")
	}
	if err := t.checkNamespace(a.Cluster, a.Namespace, false); err != nil {
		return mcp.Result{}, err
	}
	in, err := t.inspector()
	if err != nil {
		return mcp.Result{}, err
	}
	tail := a.TailLines
	if tail <= 0 {
		tail = defaultTail
	}
	if tail > maxTail {
		tail = maxTail
	}
	text, err := in.Logs(ctx, a.Cluster, a.Namespace, a.Pod, LogOptions{Container: a.Container, Previous: a.Previous, TailLines: tail, LimitBytes: logBytes})
	if err != nil {
		return mcp.Result{}, err
	}
	header := fmt.Sprintf("logs of %s/%s", a.Namespace, a.Pod)
	if a.Container != "" {
		header += " container " + a.Container
	}
	if a.Previous {
		header += " (previous instance)"
	}
	return mcp.TextResult(header + ", last " + fmt.Sprint(tail) + " lines, repeats collapsed:\n" + collapseRepeats(text)), nil
}

// collapseRepeats folds runs of identical lines into one with a count.
func collapseRepeats(s string) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	var b strings.Builder
	for i := 0; i < len(lines); {
		j := i + 1
		for j < len(lines) && lines[j] == lines[i] {
			j++
		}
		b.WriteString(lines[i])
		if n := j - i; n > 1 {
			fmt.Fprintf(&b, "  (×%d)", n)
		}
		b.WriteString("\n")
		i = j
	}
	return b.String()
}

type eventsArgs struct {
	Cluster      string `json:"cluster"`
	Namespace    string `json:"namespace"`
	WarningsOnly *bool  `json:"warningsOnly"`
	Limit        int    `json:"limit"`
}

func (t *tools) events(ctx context.Context, raw json.RawMessage, c *call) (mcp.Result, error) {
	var a eventsArgs
	if err := json.Unmarshal(raw, &a); err != nil {
		return mcp.Result{}, mcp.ArgError("invalid arguments: " + err.Error())
	}
	c.cluster, c.namespace = a.Cluster, a.Namespace
	if a.Cluster == "" {
		return mcp.Result{}, mcp.ArgError("cluster is required")
	}
	if err := t.checkNamespace(a.Cluster, a.Namespace, false); err != nil {
		return mcp.Result{}, err
	}
	allowed, _ := t.allowed(a.Cluster)
	nss := allowed
	if a.Namespace != "" {
		nss = []string{a.Namespace}
	}
	warningsOnly := a.WarningsOnly == nil || *a.WarningsOnly
	limit := a.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c.detail = fmt.Sprintf("warningsOnly=%v", warningsOnly)
	objs, err := t.d.Source.Snapshot(ctx, a.Cluster, "v1/events", nss, "", "full")
	if err != nil {
		return mcp.Result{}, err
	}
	rows := aggregate(objs, warningsOnly, nil)
	total := len(rows)
	if total > limit {
		rows = rows[:limit]
	}
	return jsonResult(map[string]any{"cluster": a.Cluster, "total": total, "truncated": total > limit, "events": rows})
}

func (t *tools) manifest(ctx context.Context, raw json.RawMessage, c *call) (mcp.Result, error) {
	a, def, err := t.resolve(raw, c)
	if err != nil {
		return mcp.Result{}, err
	}
	in, err := t.inspector()
	if err != nil {
		return mcp.Result{}, err
	}
	o, err := in.Get(ctx, a.Cluster, def.gvr, a.Namespace, a.Name)
	if err != nil {
		return mcp.Result{}, err
	}
	b, err := yaml.Marshal(cleanManifest(o))
	if err != nil {
		return mcp.Result{}, err
	}
	s := string(b)
	if len(s) > manifestBytes {
		s = s[:manifestBytes] + "\n# … truncated at 40KB\n"
	}
	return mcp.TextResult(s), nil
}

// cleanManifest deep-copies o without the noise (managedFields, …) and the
// leaks: the last-applied annotation, which holds the whole manifest, and
// every literal env value in a pod spec or pod template.
func cleanManifest(o map[string]any) map[string]any {
	var cp map[string]any
	b, _ := json.Marshal(o)
	_ = json.Unmarshal(b, &cp)
	if m := meta(cp); m != nil {
		for _, k := range []string{"managedFields", "resourceVersion", "uid", "selfLink", "generation"} {
			delete(m, k)
		}
		if ann, _ := m["annotations"].(map[string]any); ann != nil {
			delete(ann, "kubectl.kubernetes.io/last-applied-configuration")
			if len(ann) == 0 {
				delete(m, "annotations")
			}
		}
	}
	redactPodSpec(spec(cp))
	if tmpl, _ := spec(cp)["template"].(map[string]any); tmpl != nil {
		redactPodSpec(spec(tmpl))
	}
	if jt, _ := spec(cp)["jobTemplate"].(map[string]any); jt != nil {
		if tmpl, _ := spec(jt)["template"].(map[string]any); tmpl != nil {
			redactPodSpec(spec(tmpl))
		}
	}
	return cp
}

func redactPodSpec(ps map[string]any) {
	for _, list := range []string{"containers", "initContainers", "ephemeralContainers"} {
		for _, ct := range asList(ps[list]) {
			cm, _ := ct.(map[string]any)
			for _, e := range asList(cm["env"]) {
				em, _ := e.(map[string]any)
				if _, ok := em["value"]; ok {
					em["value"] = "<redacted>"
				}
			}
		}
	}
}

func (t *tools) health(ctx context.Context, raw json.RawMessage, c *call) (mcp.Result, error) {
	var a struct {
		Cluster string `json:"cluster"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return mcp.Result{}, mcp.ArgError("invalid arguments: " + err.Error())
	}
	c.cluster = a.Cluster
	if a.Cluster == "" {
		return mcp.Result{}, mcp.ArgError("cluster is required")
	}
	allowed, err := t.allowed(a.Cluster)
	if err != nil {
		return mcp.Result{}, err
	}
	out := map[string]any{"cluster": a.Cluster}
	if len(allowed) == 0 {
		nodes, err := t.d.Source.Snapshot(ctx, a.Cluster, "v1/nodes", nil, "", "full")
		if err != nil {
			return mcp.Result{}, err
		}
		ready := 0
		var notReady []string
		for _, n := range nodes {
			if nodeRow(n)["ready"] == "True" {
				ready++
			} else {
				notReady = append(notReady, str(meta(n), "name"))
			}
		}
		out["nodesReady"], out["nodesTotal"] = ready, len(nodes)
		if len(notReady) > 0 {
			out["nodesNotReady"] = notReady
		}
	} else {
		out["namespaces"] = allowed
	}
	pods, err := t.d.Source.Snapshot(ctx, a.Cluster, "v1/pods", allowed, "", "full")
	if err != nil {
		return mcp.Result{}, err
	}
	var unhealthy []map[string]any
	for _, p := range pods {
		row := podRow(p)
		phase := row["phase"]
		readyStr, _ := row["ready"].(string)
		parts := strings.SplitN(readyStr, "/", 2)
		allReady := len(parts) == 2 && parts[0] == parts[1]
		if phase == "Succeeded" || (phase == "Running" && allReady) {
			continue
		}
		unhealthy = append(unhealthy, row)
	}
	sort.Slice(unhealthy, func(i, j int) bool {
		return fmt.Sprint(unhealthy[i]["namespace"], unhealthy[i]["name"]) < fmt.Sprint(unhealthy[j]["namespace"], unhealthy[j]["name"])
	})
	out["podsTotal"], out["podsUnhealthy"] = len(pods), len(unhealthy)
	if len(unhealthy) > 25 {
		unhealthy = unhealthy[:25]
	}
	out["unhealthyPods"] = unhealthy
	if evs, err := t.d.Source.Snapshot(ctx, a.Cluster, "v1/events", allowed, "", "full"); err == nil {
		rows := aggregate(evs, true, nil)
		sort.SliceStable(rows, func(i, j int) bool { return rows[i].Count > rows[j].Count })
		if len(rows) > 10 {
			rows = rows[:10]
		}
		out["topWarnings"] = rows
	}
	return jsonResult(out)
}
