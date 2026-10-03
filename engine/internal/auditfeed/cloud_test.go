package auditfeed

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeRun struct {
	name string
	args []string
	out  string
	err  error
}

func (f *fakeRun) run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.name, f.args = name, args
	return []byte(f.out), f.err
}

func argAfter(args []string, flag string) string {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

func TestEKSReadsAuditStreamsFromCloudWatch(t *testing.T) {
	msg := func(line string) map[string]any { return map[string]any{"message": line, "timestamp": 1} }
	body, _ := json.Marshal(map[string]any{"events": []any{
		msg(execEvent),
		msg(secretRead("s1", "alice", "shop", "db", t0.Add(time.Minute))),
		msg("not json"),
	}})
	f := &fakeRun{out: string(body)}
	src := CloudSource{Kind: "eks", Cluster: "prod", Region: "eu-west-1", Profile: "ops"}
	got, err := ReadCloud(context.Background(), f.run, src, 2*time.Hour, 100, t0.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if f.name != "aws" || f.args[0] != "logs" || f.args[1] != "filter-log-events" {
		t.Fatalf("ran %s %v", f.name, f.args)
	}
	for flag, want := range map[string]string{
		"--log-group-name": "/aws/eks/prod/cluster", "--log-stream-name-prefix": "kube-apiserver-audit",
		"--region": "eu-west-1", "--profile": "ops", "--output": "json",
		"--start-time": "1790848800000",
	} {
		if got := argAfter(f.args, flag); got != want {
			t.Errorf("%s = %q, want %q", flag, got, want)
		}
	}
	if fp := argAfter(f.args, "--filter-pattern"); !strings.Contains(fp, `$.objectRef.subresource = "exec"`) || !strings.Contains(fp, `$.objectRef.resource = "secrets"`) || !strings.Contains(fp, `$.stage = "ResponseComplete"`) {
		t.Errorf("CloudWatch must filter to the events the rules read, server side: %q", fp)
	}
	if len(got) != 2 || got[0].Rule != "secret-read" || got[1].Rule != "exec-into-pod" {
		t.Errorf("events = %+v", got)
	}
}

func TestGKEConvertsCloudAuditLogEntries(t *testing.T) {
	entries := `[
	 {"insertId":"g1","timestamp":"2026-10-01T10:00:00Z","protoPayload":{"methodName":"io.k8s.core.v1.pods.exec.create","resourceName":"core/v1/namespaces/shop/pods/api-1/exec","authenticationInfo":{"principalEmail":"alice@example.com"},"requestMetadata":{"callerIp":"203.0.113.9"},"status":{}}},
	 {"insertId":"g2","timestamp":"2026-10-01T10:05:00Z","protoPayload":{"methodName":"io.k8s.core.v1.pods.create","resourceName":"core/v1/namespaces/shop/pods/debug","authenticationInfo":{"principalEmail":"bob@example.com"},"status":{},"request":{"spec":{"containers":[{"name":"c","securityContext":{"privileged":true}}]}}}},
	 {"insertId":"g3","timestamp":"2026-10-01T10:10:00Z","protoPayload":{"methodName":"io.k8s.core.v1.secrets.get","resourceName":"core/v1/namespaces/shop/secrets/db","authenticationInfo":{"principalEmail":"carol@example.com"},"status":{"code":7,"message":"forbidden"}}},
	 {"insertId":"g4","timestamp":"2026-10-01T10:15:00Z","protoPayload":{"methodName":"io.k8s.authorization.rbac.v1.clusterrolebindings.create","resourceName":"rbac.authorization.k8s.io/v1/clusterrolebindings/oops","authenticationInfo":{"principalEmail":"mallory@example.com"},"status":{},"request":{"roleRef":{"name":"cluster-admin"},"subjects":[{"kind":"User","name":"mallory"}]}}}
	]`
	f := &fakeRun{out: entries}
	src := CloudSource{Kind: "gke", Project: "my-proj", Location: "europe-west1", Cluster: "prod"}
	got, err := ReadCloud(context.Background(), f.run, src, 2*time.Hour, 100, t0.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if f.name != "gcloud" || f.args[0] != "logging" || f.args[1] != "read" || argAfter(f.args, "--project") != "my-proj" || argAfter(f.args, "--format") != "json" || argAfter(f.args, "--freshness") != "2h" {
		t.Fatalf("ran %s %v", f.name, f.args)
	}
	filter := f.args[2]
	for _, want := range []string{`resource.type="k8s_cluster"`, `resource.labels.cluster_name="prod"`, `resource.labels.location="europe-west1"`, `secrets\.(get|list|watch)`, `pods\.(exec|attach|portforward)\.create`} {
		if !strings.Contains(filter, want) {
			t.Errorf("filter %q lacks %s", filter, want)
		}
	}
	byRule := map[string]SecurityEvent{}
	for _, e := range got {
		byRule[e.Rule] = e
	}
	if e := byRule["exec-into-pod"]; e.User != "alice@example.com" || e.SourceIP != "203.0.113.9" || e.Ref == nil || e.Ref.Name != "api-1" || e.Object != "pods/exec shop/api-1" || !e.Allowed {
		t.Errorf("exec = %+v", e)
	}
	if e := byRule["privileged-pod"]; e.Detail != "privileged container c" {
		t.Errorf("privileged = %+v", e)
	}
	if e := byRule["secret-read"]; e.Allowed || e.Object != "secrets shop/db" {
		t.Errorf("a PERMISSION_DENIED read must show as denied: %+v", e)
	}
	if e := byRule["cluster-admin-binding"]; e.Object != "clusterrolebindings oops" {
		t.Errorf("binding = %+v", e)
	}
}

func TestCloudSourceRejectsValuesThatCouldBeFlags(t *testing.T) {
	bad := []CloudSource{
		{Kind: "eks", Cluster: "--endpoint-url=http://evil"},
		{Kind: "eks", Cluster: "prod", Region: "eu west"},
		{Kind: "eks", Cluster: "prod", Profile: "-x"},
		{Kind: "gke", Project: "my-proj", Location: "europe-west1", Cluster: "Prod Cluster"},
		{Kind: "gke", Project: "--impersonate", Location: "europe-west1", Cluster: "prod"},
		{Kind: "gke", Project: "my-proj", Location: `x" OR "1"="1`, Cluster: "prod"},
		{Kind: "azure", Cluster: "prod"},
	}
	for _, s := range bad {
		if err := s.Validate(); err == nil {
			t.Errorf("%+v must be rejected", s)
		}
	}
	for _, s := range []CloudSource{
		{Kind: "eks", Cluster: "prod-1"},
		{Kind: "eks", Cluster: "prod_1", Region: "us-gov-west-1", Profile: "team.ops"},
		{Kind: "gke", Project: "my-proj-123", Location: "us-central1-a", Cluster: "prod"},
	} {
		if err := s.Validate(); err != nil {
			t.Errorf("%+v: %v", s, err)
		}
	}
}

func TestCloudCLIFailureSaysWhatTheCLISaid(t *testing.T) {
	f := &fakeRun{err: errors.New("exit status 255: An error occurred (ResourceNotFoundException): The specified log group does not exist.")}
	_, err := ReadCloud(context.Background(), f.run, CloudSource{Kind: "eks", Cluster: "prod"}, time.Hour, 10, t0)
	if err == nil || !strings.Contains(err.Error(), "log group does not exist") || !strings.Contains(err.Error(), "control plane audit logging") {
		t.Errorf("err = %v", err)
	}
}
