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
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
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
// and returns up to limit security events, newest first. Lines that don't
// parse (a rotation's partial line, other log formats) are skipped.
func ReadTail(path string, maxBytes int64, limit int) ([]SecurityEvent, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, fmt.Errorf("%s is a directory, not an audit log file", path)
	}
	offset := st.Size() - maxBytes
	if offset < 0 {
		offset = 0
	}
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return nil, err
	}
	buf, err := io.ReadAll(io.LimitReader(f, maxBytes))
	if err != nil {
		return nil, err
	}
	if offset > 0 {
		// Starting mid-file: the first line is a fragment.
		if i := bytes.IndexByte(buf, '\n'); i >= 0 {
			buf = buf[i+1:]
		} else {
			buf = nil
		}
	}
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
	out := make([]SecurityEvent, 0, min(len(events), limit))
	for i := len(events) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, events[i])
	}
	return out, nil
}
