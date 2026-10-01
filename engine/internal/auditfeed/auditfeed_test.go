package auditfeed

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const execEvent = `{"kind":"Event","apiVersion":"audit.k8s.io/v1","level":"Metadata","auditID":"a1","stage":"ResponseComplete","verb":"create","user":{"username":"alice@example.com"},"sourceIPs":["10.0.0.5"],"objectRef":{"resource":"pods","namespace":"shop","name":"api-1","apiVersion":"v1","subresource":"exec"},"responseStatus":{"code":101},"stageTimestamp":"2026-10-01T10:00:00.000000Z"}`

func classifyLine(t *testing.T, line string) (SecurityEvent, bool) {
	t.Helper()
	ev, err := parseLine([]byte(line))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return Classify(ev)
}

func TestExecIntoPod(t *testing.T) {
	got, ok := classifyLine(t, execEvent)
	if !ok {
		t.Fatal("exec should be a security event")
	}
	want := SecurityEvent{
		ID: "a1", Time: "2026-10-01T10:00:00.000000Z", Rule: "exec-into-pod", Severity: "high",
		Title: "Exec into pod", User: "alice@example.com", SourceIP: "10.0.0.5",
		Object: "pods/exec shop/api-1", Allowed: true,
	}
	if got != want {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
}

func TestPrivilegedPodCreated(t *testing.T) {
	line := `{"auditID":"a2","stage":"ResponseComplete","verb":"create","user":{"username":"bob"},"objectRef":{"resource":"pods","namespace":"shop","name":"debug"},"responseStatus":{"code":201},"requestObject":{"spec":{"hostPID":true,"containers":[{"name":"c","securityContext":{"privileged":true}}]}}}`
	got, ok := classifyLine(t, line)
	if !ok || got.Rule != "privileged-pod" || got.Severity != "high" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
	if got.Detail != "privileged container c; hostPID" {
		t.Errorf("detail = %q", got.Detail)
	}
}

func TestHostPathPodIsMedium(t *testing.T) {
	line := `{"auditID":"a3","stage":"ResponseComplete","verb":"create","user":{"username":"bob"},"objectRef":{"resource":"pods","namespace":"shop","name":"x"},"responseStatus":{"code":201},"requestObject":{"spec":{"containers":[{"name":"c"}],"volumes":[{"name":"root","hostPath":{"path":"/"}}]}}}`
	got, ok := classifyLine(t, line)
	if !ok || got.Rule != "hostpath-pod" || got.Severity != "medium" || got.Detail != "hostPath / (volume root)" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
}

func TestPlainPodCreateIsNotAnEvent(t *testing.T) {
	line := `{"auditID":"a4","stage":"ResponseComplete","verb":"create","user":{"username":"bob"},"objectRef":{"resource":"pods","namespace":"shop","name":"x"},"responseStatus":{"code":201},"requestObject":{"spec":{"containers":[{"name":"c"}]}}}`
	if _, ok := classifyLine(t, line); ok {
		t.Error("an ordinary pod is not a security event")
	}
}

func TestClusterAdminBinding(t *testing.T) {
	line := `{"auditID":"a5","stage":"ResponseComplete","verb":"create","user":{"username":"bob"},"objectRef":{"resource":"clusterrolebindings","apiGroup":"rbac.authorization.k8s.io","name":"oops"},"responseStatus":{"code":201},"requestObject":{"roleRef":{"kind":"ClusterRole","name":"cluster-admin"},"subjects":[{"kind":"User","name":"mallory"}]}}`
	got, ok := classifyLine(t, line)
	if !ok || got.Rule != "cluster-admin-binding" || got.Severity != "high" || got.Object != "clusterrolebindings oops" || got.Detail != "grants cluster-admin to User mallory" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
}

func TestOtherClusterRoleBindingIsMedium(t *testing.T) {
	line := `{"auditID":"a6","stage":"ResponseComplete","verb":"create","user":{"username":"bob"},"objectRef":{"resource":"clusterrolebindings","name":"view-x"},"responseStatus":{"code":201},"requestObject":{"roleRef":{"kind":"ClusterRole","name":"view"},"subjects":[{"kind":"ServiceAccount","name":"x","namespace":"shop"}]}}`
	got, ok := classifyLine(t, line)
	if !ok || got.Rule != "clusterrolebinding-change" || got.Severity != "medium" || got.Detail != "grants view to ServiceAccount shop/x" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
}

func TestAnonymousAllowed(t *testing.T) {
	line := `{"auditID":"a7","stage":"ResponseComplete","verb":"list","user":{"username":"system:anonymous"},"objectRef":{"resource":"nodes"},"responseStatus":{"code":200}}`
	got, ok := classifyLine(t, line)
	if !ok || got.Rule != "anonymous-access" || got.Severity != "high" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
	denied := strings.Replace(line, `"code":200`, `"code":403`, 1)
	if _, ok := classifyLine(t, denied); ok {
		t.Error("a refused anonymous request is routine noise")
	}
}

func TestHumanSecretReadButNotControllers(t *testing.T) {
	human := `{"auditID":"a8","stage":"ResponseComplete","verb":"get","user":{"username":"alice"},"objectRef":{"resource":"secrets","namespace":"shop","name":"db"},"responseStatus":{"code":200}}`
	got, ok := classifyLine(t, human)
	if !ok || got.Rule != "secret-read" || got.Severity != "low" || got.Object != "secrets shop/db" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
	controller := strings.Replace(human, `"alice"`, `"system:serviceaccount:kube-system:foo"`, 1)
	if _, ok := classifyLine(t, controller); ok {
		t.Error("system identities reading secrets is routine")
	}
}

func TestDeniedExecIsKeptAndMarked(t *testing.T) {
	got, ok := classifyLine(t, strings.Replace(execEvent, `"code":101`, `"code":403`, 1))
	if !ok || got.Allowed {
		t.Fatalf("a refused exec is still worth seeing, marked denied: %+v ok=%v", got, ok)
	}
}

func TestOnlyResponseCompleteStageCounts(t *testing.T) {
	if _, ok := classifyLine(t, strings.Replace(execEvent, "ResponseComplete", "RequestReceived", 1)); ok {
		t.Error("each request is logged at several stages; count it once")
	}
}

func TestReadTailNewestFirstSkippingJunk(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	second := strings.Replace(strings.Replace(execEvent, `"a1"`, `"a9"`, 1), "10:00:00", "11:00:00", 1)
	body := "partial-line-from-rotation}\n" + execEvent + "\nnot json\n" + second + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	evs, err := ReadTail(path, 1<<20, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 2 || evs[0].ID != "a9" || evs[1].ID != "a1" {
		t.Fatalf("got %+v", evs)
	}
}

func TestReadTailOnlyReadsTheEnd(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	old := strings.Replace(execEvent, `"a1"`, `"old"`, 1)
	body := strings.Repeat(old+"\n", 50) + execEvent + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	evs, err := ReadTail(path, int64(len(execEvent)+10), 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].ID != "a1" {
		t.Fatalf("got %d events, first %+v", len(evs), evs)
	}
}

func TestReadTailCapsCount(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.log")
	if err := os.WriteFile(path, []byte(strings.Repeat(execEvent+"\n", 20)), 0o600); err != nil {
		t.Fatal(err)
	}
	evs, _ := ReadTail(path, 1<<20, 5)
	if len(evs) != 5 {
		t.Fatalf("got %d, want 5", len(evs))
	}
}
