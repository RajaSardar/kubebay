package auditfeed

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Runner runs a CLI and returns its stdout. Production uses os/exec with the
// user's own aws or gcloud; tests pass a fake.
type Runner func(ctx context.Context, name string, args ...string) ([]byte, error)

// CloudSource reads the audit log from a managed control plane through the
// provider CLI already on this machine, with the user's own credentials.
//   - eks: CloudWatch Logs group /aws/eks/<cluster>/cluster, streams
//     kube-apiserver-audit-*, which need control plane audit logging on.
//   - gke: Cloud Audit Logs for the cluster. Admin Activity is always on;
//     Secret reads need Data Access logs enabled for the Kubernetes API.
type CloudSource struct {
	Kind     string `json:"kind"`
	Cluster  string `json:"cluster"`
	Region   string `json:"region,omitempty"`
	Profile  string `json:"profile,omitempty"`
	Project  string `json:"project,omitempty"`
	Location string `json:"location,omitempty"`
}

var (
	eksClusterRe = regexp.MustCompile(`^[0-9A-Za-z][A-Za-z0-9_-]{0,99}$`)
	awsRegionRe  = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-\d$`)
	awsProfileRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,63}$`)
	gcpProjectRe = regexp.MustCompile(`^[a-z][a-z0-9-]{4,28}[a-z0-9]$`)
	gcpLocRe     = regexp.MustCompile(`^[a-z]+-[a-z]+[0-9](-[a-z])?$`)
	gkeClusterRe = regexp.MustCompile(`^[a-z]([-a-z0-9]{0,38}[a-z0-9])?$`)
)

// Validate keeps every value inside its provider's naming rules, so nothing
// can be read as a CLI flag or break out of the Cloud Logging filter.
func (s CloudSource) Validate() error {
	switch s.Kind {
	case "eks":
		if !eksClusterRe.MatchString(s.Cluster) {
			return fmt.Errorf("%q is not an EKS cluster name", s.Cluster)
		}
		if s.Region != "" && !awsRegionRe.MatchString(s.Region) {
			return fmt.Errorf("%q is not an AWS region", s.Region)
		}
		if s.Profile != "" && !awsProfileRe.MatchString(s.Profile) {
			return fmt.Errorf("%q is not an AWS profile name", s.Profile)
		}
	case "gke":
		if !gcpProjectRe.MatchString(s.Project) {
			return fmt.Errorf("%q is not a Google Cloud project ID", s.Project)
		}
		if !gcpLocRe.MatchString(s.Location) {
			return fmt.Errorf("%q is not a GKE region or zone", s.Location)
		}
		if !gkeClusterRe.MatchString(s.Cluster) {
			return fmt.Errorf("%q is not a GKE cluster name", s.Cluster)
		}
	default:
		return fmt.Errorf("unknown audit source %q (want eks or gke)", s.Kind)
	}
	return nil
}

const cloudMaxEntries = 5000

// Server-side filters to what Classify can flag, so the entry cap is spent on
// candidates rather than the routine traffic that dominates an audit log.
const (
	eksFilterPattern = `{ ($.stage = "ResponseComplete") && (($.objectRef.subresource = "exec") || ($.objectRef.subresource = "attach") || ($.objectRef.subresource = "portforward") || ($.objectRef.resource = "secrets") || ($.objectRef.resource = "clusterrolebindings") || ($.objectRef.resource = "rolebindings") || ($.user.username = "system:anonymous") || (($.objectRef.resource = "pods") && ($.verb = "create"))) }`
	gkeMethodRegex   = `io\.k8s\..*(pods\.(exec|attach|portforward)\.create|pods\.create|secrets\.(get|list|watch)|rolebindings\.(create|update|patch)|clusterrolebindings\.(create|update|patch))$`
)

// ReadCloud fetches the last `since` of audit events and returns up to limit
// security events, newest first, grouped like ReadTail's.
func ReadCloud(ctx context.Context, run Runner, src CloudSource, since time.Duration, limit int, now time.Time) ([]SecurityEvent, error) {
	if err := src.Validate(); err != nil {
		return nil, err
	}
	var events []SecurityEvent
	var err error
	switch src.Kind {
	case "eks":
		events, err = readEKS(ctx, run, src, now.Add(-since))
	case "gke":
		events, err = readGKE(ctx, run, src, since)
	}
	if err != nil {
		return nil, err
	}
	sort.SliceStable(events, func(i, j int) bool { return parseTime(events[i].Time).Before(parseTime(events[j].Time)) })
	events = groupSecretReads(events)
	out := make([]SecurityEvent, 0, min(len(events), limit))
	for i := len(events) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, events[i])
	}
	return out, nil
}

func readEKS(ctx context.Context, run Runner, src CloudSource, from time.Time) ([]SecurityEvent, error) {
	args := []string{
		"logs", "filter-log-events",
		"--log-group-name", "/aws/eks/" + src.Cluster + "/cluster",
		"--log-stream-name-prefix", "kube-apiserver-audit",
		"--filter-pattern", eksFilterPattern,
		"--start-time", strconv.FormatInt(from.UnixMilli(), 10),
		"--max-items", strconv.Itoa(cloudMaxEntries),
		"--output", "json",
	}
	if src.Region != "" {
		args = append(args, "--region", src.Region)
	}
	if src.Profile != "" {
		args = append(args, "--profile", src.Profile)
	}
	out, err := run(ctx, "aws", args...)
	if err != nil {
		return nil, fmt.Errorf("aws logs: %w (EKS writes audit events to CloudWatch only with control plane audit logging enabled)", err)
	}
	var resp struct {
		Events []struct {
			Message string `json:"message"`
		} `json:"events"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, fmt.Errorf("aws logs: unexpected output: %w", err)
	}
	var events []SecurityEvent
	for _, e := range resp.Events {
		ev, err := parseLine([]byte(e.Message))
		if err != nil {
			continue
		}
		if se, ok := Classify(ev); ok {
			events = append(events, se)
		}
	}
	return events, nil
}

func readGKE(ctx context.Context, run Runner, src CloudSource, since time.Duration) ([]SecurityEvent, error) {
	filter := fmt.Sprintf(`resource.type="k8s_cluster" AND resource.labels.cluster_name=%q AND resource.labels.location=%q AND (protoPayload.methodName=~"%s" OR protoPayload.authenticationInfo.principalEmail="system:anonymous")`, src.Cluster, src.Location, gkeMethodRegex)
	out, err := run(ctx, "gcloud", "logging", "read", filter,
		"--project", src.Project,
		"--freshness", fmt.Sprintf("%dh", max(1, int(since/time.Hour))),
		"--limit", strconv.Itoa(cloudMaxEntries),
		"--format", "json")
	if err != nil {
		return nil, fmt.Errorf("gcloud logging: %w", err)
	}
	var entries []gkeEntry
	if err := json.Unmarshal(out, &entries); err != nil {
		return nil, fmt.Errorf("gcloud logging: unexpected output: %w", err)
	}
	var events []SecurityEvent
	for _, e := range entries {
		if ev, ok := e.toEvent(); ok {
			if se, ok := Classify(ev); ok {
				events = append(events, se)
			}
		}
	}
	return events, nil
}

type gkeEntry struct {
	InsertID     string `json:"insertId"`
	Timestamp    string `json:"timestamp"`
	ProtoPayload struct {
		MethodName         string `json:"methodName"`
		ResourceName       string `json:"resourceName"`
		AuthenticationInfo struct {
			PrincipalEmail string `json:"principalEmail"`
		} `json:"authenticationInfo"`
		RequestMetadata struct {
			CallerIP string `json:"callerIp"`
		} `json:"requestMetadata"`
		Status struct {
			Code int `json:"code"`
		} `json:"status"`
		Request json.RawMessage `json:"request"`
	} `json:"protoPayload"`
}

// toEvent maps a Cloud Audit Log entry onto the audit.k8s.io Event fields the
// rules read. resourceName is "<group>/<version>/[namespaces/<ns>/]<resource>[/<name>[/<sub>]]";
// methodName ends in the verb.
func (e gkeEntry) toEvent() (Event, bool) {
	p := e.ProtoPayload
	if !strings.HasPrefix(p.MethodName, "io.k8s.") {
		return Event{}, false
	}
	verb := p.MethodName[strings.LastIndex(p.MethodName, ".")+1:]
	parts := strings.Split(p.ResourceName, "/")
	if len(parts) < 3 {
		return Event{}, false
	}
	rest := parts[2:]
	ns := ""
	if len(rest) >= 3 && rest[0] == "namespaces" {
		ns, rest = rest[1], rest[2:]
	}
	var ev Event
	ev.AuditID, ev.Verb, ev.StageTimestamp = e.InsertID, verb, e.Timestamp
	// GKE records anonymous calls as "system:anonymous"; a missing principal is
	// unknown, never assumed anonymous.
	ev.User.Username = p.AuthenticationInfo.PrincipalEmail
	if ev.User.Username == "" {
		ev.User.Username = "(unknown)"
	}
	if p.RequestMetadata.CallerIP != "" {
		ev.SourceIPs = []string{p.RequestMetadata.CallerIP}
	}
	ref := &struct {
		Resource    string `json:"resource"`
		Subresource string `json:"subresource"`
		Namespace   string `json:"namespace"`
		Name        string `json:"name"`
	}{Resource: rest[0], Namespace: ns}
	if len(rest) > 1 {
		ref.Name = rest[1]
	}
	if len(rest) > 2 {
		ref.Subresource = rest[2]
	}
	ev.ObjectRef = ref
	// gRPC status: 0 OK, 7 PERMISSION_DENIED, 16 UNAUTHENTICATED.
	code := 200
	switch p.Status.Code {
	case 0:
	case 7:
		code = 403
	case 16:
		code = 401
	default:
		code = 500
	}
	ev.ResponseStatus = &struct {
		Code int `json:"code"`
	}{code}
	ev.RequestObject = p.Request
	return ev, true
}
