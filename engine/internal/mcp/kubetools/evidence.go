package kubetools

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"sigs.k8s.io/yaml"

	"github.com/RajaSardar/kubebay/engine/internal/redact"
)

// EvidenceSource is what the evidence assembler reads: lists from the
// informer cache, plus one object and a pod's logs.
type EvidenceSource interface {
	Source
	Inspector
}

// EvidenceSection is one numbered piece of a triage bundle. A model's claims
// about the pod cite these IDs, and the UI shows the cited text under each.
type EvidenceSection struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

// Evidence is everything incident triage sends about one pod (backlog #13).
type Evidence struct {
	Cluster   string            `json:"cluster"`
	Namespace string            `json:"namespace"`
	Pod       string            `json:"pod"`
	Sections  []EvidenceSection `json:"sections"`
	// Masked counts the credentials the redaction pass replaced.
	Masked int `json:"masked"`
	// Truncated is set when logs were cut to fit the budget.
	Truncated bool `json:"truncated"`
}

// DefaultEvidenceBudget is about 12k tokens of text.
const DefaultEvidenceBudget = 48 << 10

const (
	evidenceEvents    = 15
	evidenceRevisions = 5
	previousTail      = 100
	currentTail       = 50
	minLogShare       = 400
	cutMarker         = "… (earlier lines cut)\n"
)

// Text is the bundle as the model reads it: each section under its ID.
func (e Evidence) Text() string {
	var b strings.Builder
	for _, s := range e.Sections {
		b.WriteString(sectionText(s))
	}
	return b.String()
}

func sectionText(s EvidenceSection) string {
	return fmt.Sprintf("[%s] %s\n%s\n\n", s.ID, s.Title, strings.TrimRight(s.Text, "\n"))
}

func toYAML(v any) string {
	b, err := yaml.Marshal(v)
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(b)
}

// BuildEvidence assembles one pod's triage bundle, deliberately rather than
// as a YAML dump: the pod and its owners, container states with the last
// termination, Warning events for the pod and its owners deduped with
// counts, the Deployment's recent revisions, and logs, with a restarted
// container's previous run first because that's where a crash is. Every
// section passes the redaction pass; logs are cut from the start to fit
// budget characters (0 means DefaultEvidenceBudget).
func BuildEvidence(ctx context.Context, src EvidenceSource, cluster, ns, name string, budget int) (Evidence, error) {
	if budget <= 0 {
		budget = DefaultEvidenceBudget
	}
	o, err := src.Get(ctx, cluster, "v1/pods", ns, name)
	if err != nil {
		return Evidence{}, err
	}
	owners := ownerChain(ctx, src, cluster, ns, o)
	e := Evidence{Cluster: cluster, Namespace: ns, Pod: name}
	var logs []EvidenceSection
	add := func(to *[]EvidenceSection, title, text string) {
		masked, n := redact.String(text)
		e.Masked += n
		*to = append(*to, EvidenceSection{Title: title, Text: masked})
	}

	podInfo := map[string]any{"phase": str(status(o), "phase"), "node": str(spec(o), "nodeName"), "created": str(meta(o), "creationTimestamp")}
	for _, k := range []string{"reason", "message"} {
		if v := str(status(o), k); v != "" {
			podInfo[k] = v
		}
	}
	if len(owners) > 0 {
		podInfo["owners"] = owners
	}
	if c := conditions(o); len(c) > 0 {
		podInfo["conditions"] = c
	}
	add(&e.Sections, "Pod "+ns+"/"+name, toYAML(podInfo))
	containers := containerDetail(o)
	add(&e.Sections, "Containers", toYAML(containers))

	involved := map[string]bool{"Pod/" + name: true}
	for _, ow := range owners {
		involved[ow] = true
	}
	evs, err := src.Snapshot(ctx, cluster, "v1/events", []string{ns}, "", "full")
	switch rows := aggregate(evs, true, func(inv map[string]any) bool { return involved[str(inv, "kind")+"/"+str(inv, "name")] }); {
	case err != nil:
		add(&e.Sections, "Warning events", "couldn't read events: "+err.Error())
	case len(rows) == 0:
		add(&e.Sections, "Warning events", "none for the pod or its owners")
	default:
		if len(rows) > evidenceEvents {
			rows = rows[:evidenceEvents]
		}
		add(&e.Sections, "Warning events (pod and owners, deduped)", toYAML(rows))
	}

	for _, ow := range owners {
		if dep, ok := strings.CutPrefix(ow, "Deployment/"); ok {
			if h := rolloutHistory(ctx, src, cluster, ns, dep); h != "" {
				add(&e.Sections, "Rollout history of Deployment "+dep, h)
			}
		}
	}

	for _, c := range containers {
		cname, _ := c["name"].(string)
		restarts, _ := c["restarts"].(int)
		state, _ := c["state"].(map[string]any)
		if _, started := c["restarts"]; !started {
			continue
		}
		if init, _ := c["init"].(bool); init && restarts == 0 && state["state"] == "terminated" && state["exitCode"] == 0 {
			continue
		}
		if restarts > 0 {
			title := "Logs of " + cname + " (previous run"
			if last, _ := c["lastState"].(map[string]any); last != nil {
				if code, ok := last["exitCode"]; ok {
					title += fmt.Sprintf(", exited %v", code)
				}
				if r, _ := last["reason"].(string); r != "" {
					title += ": " + r
				}
			}
			add(&logs, title+")", readLogs(ctx, src, cluster, ns, name, cname, true, previousTail))
		}
		add(&logs, "Logs of "+cname+" (current)", readLogs(ctx, src, cluster, ns, name, cname, false, currentTail))
	}

	fixed := 0
	for _, s := range e.Sections {
		fixed += len(sectionText(EvidenceSection{ID: "E00", Title: s.Title, Text: s.Text}))
	}
	e.Truncated = fitLogs(logs, budget-fixed)
	e.Sections = append(e.Sections, logs...)
	for i := range e.Sections {
		e.Sections[i].ID = "E" + strconv.Itoa(i+1)
	}
	return e, nil
}

func readLogs(ctx context.Context, in Inspector, cluster, ns, pod, container string, previous bool, tail int) string {
	text, err := in.Logs(ctx, cluster, ns, pod, LogOptions{Container: container, Previous: previous, TailLines: tail, LimitBytes: logBytes})
	if err != nil {
		return "couldn't read logs: " + err.Error()
	}
	if strings.TrimSpace(text) == "" {
		return "(empty)"
	}
	return collapseRepeats(text)
}

// fitLogs shares room between log sections, shortest first so short logs
// stay whole, cutting each from the start: a crash's last lines matter most.
func fitLogs(logs []EvidenceSection, room int) bool {
	order := make([]int, len(logs))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return len(logs[order[a]].Text) < len(logs[order[b]].Text) })
	cut := false
	for k, i := range order {
		overhead := len(sectionText(EvidenceSection{ID: "E00", Title: logs[i].Title}))
		share := room/(len(order)-k) - overhead
		if share < minLogShare {
			share = minLogShare
		}
		if t := logs[i].Text; len(t) > share {
			t = t[len(t)-share+len(cutMarker):]
			if nl := strings.IndexByte(t, '\n'); nl >= 0 && nl < len(t)-1 {
				t = t[nl+1:]
			}
			logs[i].Text = cutMarker + t
			cut = true
		}
		room -= len(logs[i].Text) + overhead
	}
	return cut
}

// rolloutHistory lists a Deployment's newest ReplicaSets by revision.
func rolloutHistory(ctx context.Context, src Source, cluster, ns, dep string) string {
	rss, err := src.Snapshot(ctx, cluster, "apps/v1/replicasets", []string{ns}, "", "full")
	if err != nil {
		return ""
	}
	type rev struct {
		n    int
		line string
	}
	var revs []rev
	for _, rs := range rss {
		owned := false
		for _, ref := range asList(meta(rs)["ownerReferences"]) {
			rm, _ := ref.(map[string]any)
			if c, _ := rm["controller"].(bool); c && str(rm, "kind") == "Deployment" && str(rm, "name") == dep {
				owned = true
			}
		}
		if !owned {
			continue
		}
		ann, _ := meta(rs)["annotations"].(map[string]any)
		n, _ := strconv.Atoi(str(ann, "deployment.kubernetes.io/revision"))
		tmpl, _ := spec(rs)["template"].(map[string]any)
		var images []string
		for _, ct := range asList(spec(tmpl)["containers"]) {
			cm, _ := ct.(map[string]any)
			images = append(images, str(cm, "name")+"="+str(cm, "image"))
		}
		revs = append(revs, rev{n, fmt.Sprintf("revision %d: %s (ReplicaSet %s, created %s, ready %d/%d)",
			n, strings.Join(images, ", "), str(meta(rs), "name"), str(meta(rs), "creationTimestamp"), num(status(rs), "readyReplicas"), num(spec(rs), "replicas"))})
	}
	sort.Slice(revs, func(i, j int) bool { return revs[i].n > revs[j].n })
	if len(revs) > evidenceRevisions {
		revs = revs[:evidenceRevisions]
	}
	var b strings.Builder
	for _, r := range revs {
		b.WriteString(r.line + "\n")
	}
	return b.String()
}
