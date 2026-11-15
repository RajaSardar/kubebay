package kubetools

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func evidenceSetup() *setup {
	s := inspectSetup()
	rs := func(name, rev, image string) map[string]any {
		return map[string]any{
			"metadata": map[string]any{
				"name": name, "namespace": "shop", "creationTimestamp": "2026-10-10T07:00:00Z",
				"annotations":     map[string]any{"deployment.kubernetes.io/revision": rev},
				"ownerReferences": []any{map[string]any{"kind": "Deployment", "name": "api", "controller": true}},
			},
			"spec":   map[string]any{"replicas": float64(1), "template": map[string]any{"spec": map[string]any{"containers": []any{map[string]any{"name": "api", "image": image}}}}},
			"status": map[string]any{"replicas": float64(1), "readyReplicas": float64(0)},
		}
	}
	s.src.objs["apps/v1/replicasets"] = []map[string]any{rs("api-7d9", "3", "ghcr.io/acme/api:1.4"), rs("api-6c8", "2", "ghcr.io/acme/api:1.3")}
	s.src.objs["v1/events"] = append(s.src.objs["v1/events"], event("shop", "Deployment", "api", "Warning", "ProgressDeadlineExceeded", "ReplicaSet api-7d9 has timed out progressing", 1))
	return s
}

func titles(e Evidence) []string {
	var out []string
	for _, s := range e.Sections {
		out = append(out, s.ID+" "+s.Title)
	}
	return out
}

func TestEvidenceIsTheCrashloopBundle(t *testing.T) {
	s := evidenceSetup()
	e, err := BuildEvidence(context.Background(), s.src, "kind-dev", "shop", "api-7d9-x", 0)
	if err != nil {
		t.Fatal(err)
	}
	all := e.Text()
	for _, want := range []string{
		"CrashLoopBackOff", "exitCode: 2", "ReplicaSet/api-7d9", "Deployment/api", // pod and containers
		"BackOff", "count: 40", "ProgressDeadlineExceeded", // warnings for the pod and its owners
		"revision 3", "ghcr.io/acme/api:1.4", "revision 2", "ghcr.io/acme/api:1.3", // rollout history
		"panic: nil map  (×3)", // previous run's logs, collapsed
	} {
		if !strings.Contains(all, want) {
			t.Errorf("bundle should mention %q:\n%s", want, all)
		}
	}
	for _, leak := range []string{"hunter2", "Pulled", "Readiness probe failed", "FailedScheduling", "last-applied-configuration", "managedFields"} {
		if strings.Contains(all, leak) {
			t.Errorf("bundle must not contain %q:\n%s", leak, all)
		}
	}
	ts := titles(e)
	prev, cur := -1, -1
	for i, ti := range ts {
		if strings.Contains(ti, "api (previous run") {
			prev = i
		}
		if strings.Contains(ti, "api (current)") {
			cur = i
		}
	}
	if prev < 0 || cur < 0 || prev > cur {
		t.Errorf("a restarted container's previous run comes first: %v", ts)
	}
	for i, sec := range e.Sections {
		if want := "E" + string(rune('1'+i)); sec.ID != want {
			t.Errorf("section %d id = %s, want %s", i, sec.ID, want)
		}
	}
}

func TestEvidenceFitsTheBudgetKeepingTheEndOfLogs(t *testing.T) {
	s := evidenceSetup()
	var b strings.Builder
	for i := 0; i < 4000; i++ {
		fmt.Fprintf(&b, "GET /healthz 200 req=%d\n", i)
	}
	s.src.currentLogs = b.String() + "fatal: cannot bind :8080\n"
	e, err := BuildEvidence(context.Background(), s.src, "kind-dev", "shop", "api-7d9-x", 6000)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(e.Text()); n > 6500 {
		t.Errorf("bundle is %d chars for a 6000 budget", n)
	}
	if !e.Truncated || !strings.Contains(e.Text(), "fatal: cannot bind :8080") {
		t.Errorf("truncated=%v; the last log lines must survive:\n%s", e.Truncated, e.Text())
	}
}

func TestEvidenceMasksCredentialsInLogsAndMessages(t *testing.T) {
	s := evidenceSetup()
	s.src.currentLogs = "connecting to postgres://app:s3cr3tpw@db/shop\n"
	s.src.objs["v1/events"] = append(s.src.objs["v1/events"], event("shop", "Pod", "api-7d9-x", "Warning", "Failed", "pull failed: token=ghp_0123456789abcdefghijABCDEFGHIJ012345", 2))
	e, err := BuildEvidence(context.Background(), s.src, "kind-dev", "shop", "api-7d9-x", 0)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(e.Text(), "s3cr3tpw") || strings.Contains(e.Text(), "ghp_0123") || e.Masked < 2 {
		t.Errorf("masked=%d:\n%s", e.Masked, e.Text())
	}
}

func TestEvidenceForAMissingPodIsAnError(t *testing.T) {
	s := evidenceSetup()
	if _, err := BuildEvidence(context.Background(), s.src, "kind-dev", "shop", "nope", 0); err == nil {
		t.Error("want an error")
	}
}
