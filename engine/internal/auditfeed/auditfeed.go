// Package auditfeed turns a Kubernetes API server audit log into a short
// feed of security-relevant events (intelligence roadmap Tier 3 #26). It
// needs no in-cluster agent, only an audit log the user already writes and
// points Kubebay at. The rules follow the categories of Falco's k8saudit
// plugin: exec/attach into pods, privileged or host-namespace pods, hostPath
// mounts, cluster-admin and other ClusterRoleBindings, anonymous access that
// succeeded, and people (not controllers) reading Secrets.
package auditfeed

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Event is the subset of audit.k8s.io/v1 Event the rules read.
type Event struct {
	AuditID string `json:"auditID"`
	Stage   string `json:"stage"`
	Verb    string `json:"verb"`
	User    struct {
		Username string `json:"username"`
	} `json:"user"`
	SourceIPs []string `json:"sourceIPs"`
	ObjectRef *struct {
		Resource    string `json:"resource"`
		Subresource string `json:"subresource"`
		Namespace   string `json:"namespace"`
		Name        string `json:"name"`
	} `json:"objectRef"`
	ResponseStatus *struct {
		Code int `json:"code"`
	} `json:"responseStatus"`
	RequestObject            json.RawMessage `json:"requestObject"`
	StageTimestamp           string          `json:"stageTimestamp"`
	RequestReceivedTimestamp string          `json:"requestReceivedTimestamp"`
}

// SecurityEvent is one feed row. It never carries request or response
// bodies, only what happened, who did it and to what.
type SecurityEvent struct {
	ID       string `json:"id"`
	Time     string `json:"time"`
	Rule     string `json:"rule"`
	Severity string `json:"severity"`
	Title    string `json:"title"`
	User     string `json:"user"`
	SourceIP string `json:"sourceIP,omitempty"`
	Object   string `json:"object"`
	Detail   string `json:"detail,omitempty"`
	Allowed  bool   `json:"allowed"`
	// Ref is the object acted on, for linking to it; nil for a grouped row
	// spanning several objects or a request with no object.
	Ref *ObjectRef `json:"ref,omitempty"`
	// Count and FirstTime are set on a row that groups several Secret reads.
	Count     int    `json:"count,omitempty"`
	FirstTime string `json:"firstTime,omitempty"`
}

type ObjectRef struct {
	Resource  string `json:"resource"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
}

func parseLine(b []byte) (Event, error) {
	var ev Event
	err := json.Unmarshal(b, &ev)
	return ev, err
}

type podSpec struct {
	Spec struct {
		HostPID        bool `json:"hostPID"`
		HostNetwork    bool `json:"hostNetwork"`
		HostIPC        bool `json:"hostIPC"`
		InitContainers []struct {
			Name            string `json:"name"`
			SecurityContext *struct {
				Privileged *bool `json:"privileged"`
			} `json:"securityContext"`
		} `json:"initContainers"`
		Containers []struct {
			Name            string `json:"name"`
			SecurityContext *struct {
				Privileged *bool `json:"privileged"`
			} `json:"securityContext"`
		} `json:"containers"`
		Volumes []struct {
			Name     string `json:"name"`
			HostPath *struct {
				Path string `json:"path"`
			} `json:"hostPath"`
		} `json:"volumes"`
	} `json:"spec"`
}

type binding struct {
	RoleRef struct {
		Name string `json:"name"`
	} `json:"roleRef"`
	Subjects []struct {
		Kind      string `json:"kind"`
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"subjects"`
}

func objectLabel(ev Event) string {
	o := ev.ObjectRef
	res := o.Resource
	if o.Subresource != "" {
		res += "/" + o.Subresource
	}
	switch {
	case o.Namespace != "" && o.Name != "":
		return res + " " + o.Namespace + "/" + o.Name
	case o.Name != "":
		return res + " " + o.Name
	case o.Namespace != "":
		return res + " " + o.Namespace + "/*"
	default:
		return res
	}
}

func podRisks(raw json.RawMessage) (privileged []string, hostPaths []string) {
	var p podSpec
	if len(raw) == 0 || json.Unmarshal(raw, &p) != nil {
		return nil, nil
	}
	for _, c := range p.Spec.InitContainers {
		if c.SecurityContext != nil && c.SecurityContext.Privileged != nil && *c.SecurityContext.Privileged {
			privileged = append(privileged, "privileged init container "+c.Name)
		}
	}
	for _, c := range p.Spec.Containers {
		if c.SecurityContext != nil && c.SecurityContext.Privileged != nil && *c.SecurityContext.Privileged {
			privileged = append(privileged, "privileged container "+c.Name)
		}
	}
	if p.Spec.HostPID {
		privileged = append(privileged, "hostPID")
	}
	if p.Spec.HostNetwork {
		privileged = append(privileged, "hostNetwork")
	}
	if p.Spec.HostIPC {
		privileged = append(privileged, "hostIPC")
	}
	for _, v := range p.Spec.Volumes {
		if v.HostPath != nil {
			hostPaths = append(hostPaths, fmt.Sprintf("hostPath %s (volume %s)", v.HostPath.Path, v.Name))
		}
	}
	return privileged, hostPaths
}

func bindingDetail(raw json.RawMessage) (role, detail string) {
	var b binding
	if len(raw) == 0 || json.Unmarshal(raw, &b) != nil {
		return "", ""
	}
	subs := make([]string, 0, len(b.Subjects))
	for _, s := range b.Subjects {
		if s.Namespace != "" {
			subs = append(subs, s.Kind+" "+s.Namespace+"/"+s.Name)
		} else {
			subs = append(subs, s.Kind+" "+s.Name)
		}
	}
	return b.RoleRef.Name, fmt.Sprintf("grants %s to %s", b.RoleRef.Name, strings.Join(subs, ", "))
}

func isSystemUser(u string) bool {
	return strings.HasPrefix(u, "system:")
}

// Classify reports whether ev is a security event, and which.
func Classify(ev Event) (SecurityEvent, bool) {
	if ev.Stage != "" && ev.Stage != "ResponseComplete" {
		return SecurityEvent{}, false
	}
	code := 0
	if ev.ResponseStatus != nil {
		code = ev.ResponseStatus.Code
	}
	allowed := code == 0 || code < 400
	out := SecurityEvent{ID: ev.AuditID, Time: ev.StageTimestamp, User: ev.User.Username, Allowed: allowed}
	if out.Time == "" {
		out.Time = ev.RequestReceivedTimestamp
	}
	if len(ev.SourceIPs) > 0 {
		out.SourceIP = ev.SourceIPs[0]
	}
	if ev.ObjectRef == nil {
		if ev.User.Username == "system:anonymous" && allowed {
			out.Rule, out.Severity, out.Title, out.Object = "anonymous-access", "high", "Anonymous request allowed", ev.Verb
			return out, true
		}
		return SecurityEvent{}, false
	}
	o := ev.ObjectRef
	out.Object = objectLabel(ev)
	out.Ref = &ObjectRef{Resource: o.Resource, Namespace: o.Namespace, Name: o.Name}
	set := func(rule, severity, title string) (SecurityEvent, bool) {
		out.Rule, out.Severity, out.Title = rule, severity, title
		return out, true
	}

	if ev.User.Username == "system:anonymous" && allowed {
		return set("anonymous-access", "high", "Anonymous request allowed")
	}
	if o.Resource == "pods" {
		switch o.Subresource {
		case "exec":
			return set("exec-into-pod", "high", "Exec into pod")
		case "attach":
			return set("attach-to-pod", "high", "Attach to pod")
		case "portforward":
			return set("port-forward", "medium", "Port-forward to pod")
		}
		if ev.Verb == "create" && o.Subresource == "" {
			priv, hostPaths := podRisks(ev.RequestObject)
			out.Detail = strings.Join(append(append([]string{}, priv...), hostPaths...), "; ")
			if len(priv) > 0 {
				return set("privileged-pod", "high", "Privileged or host-namespace pod created")
			}
			if len(hostPaths) > 0 {
				return set("hostpath-pod", "medium", "Pod with a hostPath volume created")
			}
		}
		return SecurityEvent{}, false
	}
	if (o.Resource == "clusterrolebindings" || o.Resource == "rolebindings") && (ev.Verb == "create" || ev.Verb == "update" || ev.Verb == "patch") {
		role, detail := bindingDetail(ev.RequestObject)
		out.Detail = detail
		if role == "cluster-admin" {
			return set("cluster-admin-binding", "high", "Binding to cluster-admin")
		}
		if o.Resource == "clusterrolebindings" {
			return set("clusterrolebinding-change", "medium", "ClusterRoleBinding changed")
		}
		return SecurityEvent{}, false
	}
	if o.Resource == "secrets" && (ev.Verb == "get" || ev.Verb == "list" || ev.Verb == "watch") && !isSystemUser(ev.User.Username) {
		return set("secret-read", "low", "Secret read by a person")
	}
	return SecurityEvent{}, false
}

// ReadTail reads at most maxBytes from the end of an audit log (JSON lines)
// and returns up to limit security events, newest first. When the live file
// leaves budget, its rotations (audit.log.1, audit-<time>.log, .gz or not)
// are read too, newest first. Lines that don't parse (a rotation's partial
// line, other log formats) are skipped. Secret reads by one person close
// together come back as one row.
func ReadTail(path string, maxBytes int64, limit int) ([]SecurityEvent, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, fmt.Errorf("%s is a directory, not an audit log file", path)
	}
	buf, err := tailFile(path, maxBytes)
	if err != nil {
		return nil, err
	}
	events := classifyAll(buf)
	budget := maxBytes - min(st.Size(), maxBytes)
	for _, rp := range rotatedFiles(path) {
		if budget <= 0 {
			break
		}
		b, err := tailFile(rp, budget)
		if err != nil {
			continue
		}
		budget -= int64(len(b))
		events = append(events, classifyAll(b)...)
	}
	sort.SliceStable(events, func(i, j int) bool { return parseTime(events[i].Time).Before(parseTime(events[j].Time)) })
	events = groupSecretReads(events)
	out := make([]SecurityEvent, 0, min(len(events), limit))
	for i := len(events) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, events[i])
	}
	return out, nil
}

func classifyAll(buf []byte) []SecurityEvent {
	var events []SecurityEvent
	for _, line := range bytes.Split(buf, []byte{'\n'}) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 || line[0] != '{' {
			continue
		}
		ev, err := parseLine(line)
		if err != nil {
			continue
		}
		if se, ok := Classify(ev); ok {
			events = append(events, se)
		}
	}
	return events
}

// tailFile returns the last maxBytes of a file, decompressing .gz, with a
// leading partial line dropped when it starts mid-file.
func tailFile(path string, maxBytes int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var buf []byte
	cut := false
	if strings.HasSuffix(path, ".gz") {
		zr, err := gzip.NewReader(f)
		if err != nil {
			return nil, err
		}
		defer zr.Close()
		// Keep only the newest maxBytes of the decompressed stream.
		chunk := make([]byte, 64<<10)
		for {
			n, rerr := zr.Read(chunk)
			buf = append(buf, chunk[:n]...)
			if over := int64(len(buf)) - maxBytes; over > 0 {
				buf = append(buf[:0], buf[over:]...)
				cut = true
			}
			if rerr == io.EOF {
				break
			}
			if rerr != nil {
				return nil, rerr
			}
		}
	} else {
		st, err := f.Stat()
		if err != nil {
			return nil, err
		}
		offset := max(st.Size()-maxBytes, 0)
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return nil, err
		}
		if buf, err = io.ReadAll(io.LimitReader(f, maxBytes)); err != nil {
			return nil, err
		}
		cut = offset > 0
	}
	if cut {
		if i := bytes.IndexByte(buf, '\n'); i >= 0 {
			buf = buf[i+1:]
		} else {
			buf = nil
		}
	}
	return buf, nil
}

// rotatedFiles lists the rotations of path, newest first: logrotate's
// audit.log.1 and audit.log-20261001, and the API server's own
// audit-2026-10-01T09-00-00.000.log, each possibly gzipped.
func rotatedFiles(path string) []string {
	dir, base := filepath.Split(path)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	entries, err := os.ReadDir(filepath.Clean(dir))
	if err != nil {
		return nil
	}
	type cand struct {
		path string
		mod  time.Time
	}
	var out []cand
	for _, e := range entries {
		name := strings.TrimSuffix(e.Name(), ".gz")
		if e.IsDir() || e.Name() == base {
			continue
		}
		rotated := strings.HasPrefix(name, base+".") || strings.HasPrefix(name, base+"-") ||
			(ext != "" && strings.HasPrefix(name, stem+"-") && strings.HasSuffix(name, ext))
		if !rotated {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, cand{filepath.Join(dir, e.Name()), info.ModTime()})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].mod.Equal(out[j].mod) {
			return out[i].mod.After(out[j].mod)
		}
		return out[i].path > out[j].path
	})
	paths := make([]string, len(out))
	for i, c := range out {
		paths[i] = c.path
	}
	return paths
}

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}

const (
	// secretReadGap ends a group: reads further apart are separate rows.
	secretReadGap = 10 * time.Minute
	// secretReadBurst reads in one group make it a burst worth flagging.
	secretReadBurst  = 20
	maxListedSecrets = 5
)

// groupSecretReads folds each person's Secret reads that follow within
// secretReadGap of each other into one row, so a scripted sweep reads as one
// burst rather than hundreds of rows. events must be oldest first.
func groupSecretReads(events []SecurityEvent) []SecurityEvent {
	type group struct{ members []SecurityEvent }
	var groups []*group
	open := map[string]*group{}
	var out []SecurityEvent
	for _, e := range events {
		if e.Rule != "secret-read" {
			out = append(out, e)
			continue
		}
		key := fmt.Sprintf("%s|%v", e.User, e.Allowed)
		g := open[key]
		if g != nil {
			last := parseTime(g.members[len(g.members)-1].Time)
			at := parseTime(e.Time)
			if last.IsZero() || at.IsZero() || at.Sub(last) > secretReadGap {
				g = nil
			}
		}
		if g == nil {
			g = &group{}
			groups = append(groups, g)
			open[key] = g
		}
		g.members = append(g.members, e)
	}
	for _, g := range groups {
		out = append(out, mergeSecretReads(g.members))
	}
	sort.SliceStable(out, func(i, j int) bool { return parseTime(out[i].Time).Before(parseTime(out[j].Time)) })
	return out
}

func mergeSecretReads(m []SecurityEvent) SecurityEvent {
	if len(m) == 1 {
		return m[0]
	}
	row := m[len(m)-1]
	row.Count, row.FirstTime = len(m), m[0].Time
	seen := map[string]bool{}
	var names []string
	namespaces := map[string]bool{}
	for _, e := range m {
		if e.Ref == nil {
			continue
		}
		namespaces[e.Ref.Namespace] = true
		key := e.Ref.Name
		if e.Ref.Namespace != "" {
			key = e.Ref.Namespace + "/" + e.Ref.Name
		}
		if !seen[key] {
			seen[key] = true
			names = append(names, key)
		}
	}
	sort.Strings(names)
	if len(names) != 1 {
		row.Ref = nil
		row.Object = "secrets"
		if len(namespaces) == 1 {
			for ns := range namespaces {
				if ns != "" {
					row.Object = "secrets " + ns + "/*"
				}
			}
		}
	}
	listed := names
	more := ""
	if len(listed) > maxListedSecrets {
		listed, more = listed[:maxListedSecrets], fmt.Sprintf(" and %d more", len(names)-maxListedSecrets)
	}
	noun := "Secrets"
	if len(names) == 1 {
		noun = "Secret"
	}
	row.Detail = fmt.Sprintf("%d reads of %d %s: %s%s", len(m), len(names), noun, strings.Join(listed, ", "), more)
	if len(m) >= secretReadBurst {
		row.Severity, row.Title = "medium", "Burst of Secret reads by a person"
	}
	return row
}
