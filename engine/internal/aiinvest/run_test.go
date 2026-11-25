package aiinvest

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
)

const fakeClaude = `#!/bin/bash
out="$CLAUDE_FAKE_OUT"
emit() { printf '{"type":"assistant","message":{"content":[{"type":"text","text":"%s"}]}}\n' "$1"; }
case "$CLAUDE_FAKE_MODE" in
info)
  pwd > "$out/pwd.txt"; ls -A . > "$out/ls.txt"; env > "$out/env.txt"
  printf '%s\n' "$@" > "$out/args.txt"
  for i in "$@"; do if [ "$prev" = "--mcp-config" ]; then cat "$i" > "$out/cfg.txt"; fi; prev="$i"; done
  emit "hello"
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__kubebay__list_clusters","input":{"secret":"hidden"}}]}}\n'
  printf '{"type":"result","is_error":false,"result":"hello"}\n' ;;
sleep) sleep 60 ;;
trap) trap '' TERM; echo ready > "$out/ready"; while true; do sleep 1; done ;;
fork) sleep 300 & echo $! > "$out/child.pid"; echo ready > "$out/ready"; wait ;;
flood) while true; do emit "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; done ;;
crash) echo "Not logged in" >&2; exit 3 ;;
esac
`

type harness struct {
	m     *Manager
	out   string
	root  string
	mu    sync.Mutex
	audit []audit.Entry
	mints int
	revs  int
}

func newHarness(t *testing.T, mode string) *harness {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "claude")
	if err := os.WriteFile(bin, []byte(fakeClaude), 0o755); err != nil {
		t.Fatal(err)
	}
	h := &harness{out: t.TempDir(), root: t.TempDir()}
	h.m = &Manager{
		Claude:   bin,
		MCPURL:   "http://127.0.0.1:9/mcp",
		Allowed:  []string{"mcp__kubebay__list_clusters"},
		TempRoot: h.root,
		Limits:   Limits{Wall: 5 * time.Second, MaxOutput: 4096, Grace: 300 * time.Millisecond},
		Env: func() []string {
			return []string{"PATH=/usr/bin:/bin", "HOME=/tmp", "CLAUDE_FAKE_MODE=" + mode, "CLAUDE_FAKE_OUT=" + h.out,
				"KUBECONFIG=/Users/x/.kube/config", "KUBEBAY_TOKEN=launch-secret", "AWS_SECRET_ACCESS_KEY=aws", "GITHUB_TOKEN=gh"}
		},
		Mint: func(cluster, ns string, ttl time.Duration) (string, func(), error) {
			h.mu.Lock()
			h.mints++
			h.mu.Unlock()
			return "run-token-abc", func() { h.mu.Lock(); h.revs++; h.mu.Unlock() }, nil
		},
		Audit: func(e audit.Entry) { h.mu.Lock(); h.audit = append(h.audit, e); h.mu.Unlock() },
	}
	t.Cleanup(h.m.Shutdown)
	return h
}

func (h *harness) wait(t *testing.T, inv *Investigation) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for i := 0; ; {
		evs, done := inv.Wait(ctx, i)
		i += len(evs)
		if done {
			return inv.Outcome()
		}
		if ctx.Err() != nil {
			t.Fatal("run did not finish")
		}
	}
}

func read(t *testing.T, dir, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

var req = Request{Cluster: "c1", Namespace: "prod", Kind: "pods", Name: "web-1", IssueID: "pod-problem|pods|prod|web-1|CrashLoopBackOff", Title: "CrashLoopBackOff", Detail: "back-off restarting"}

func TestRunIsolationAndEnv(t *testing.T) {
	h := newHarness(t, "info")
	inv, err := h.m.Start("local", req)
	if err != nil {
		t.Fatal(err)
	}
	if got := h.wait(t, inv); got != "done" {
		t.Fatalf("outcome %q", got)
	}
	pwd := strings.TrimSpace(read(t, h.out, "pwd.txt"))
	if real, _ := filepath.EvalSymlinks(h.root); !strings.HasPrefix(pwd, real) && !strings.HasPrefix(pwd, h.root) {
		t.Fatalf("cwd %q is not under the temp root %q", pwd, h.root)
	}
	if strings.TrimSpace(read(t, h.out, "ls.txt")) != "" {
		t.Fatalf("working directory not empty: %q", read(t, h.out, "ls.txt"))
	}
	if _, err := os.Stat(pwd); !os.IsNotExist(err) {
		t.Fatalf("temp dir left behind: %v", err)
	}
	if entries, _ := os.ReadDir(h.root); len(entries) != 0 {
		t.Fatalf("temp root not empty: %v", entries)
	}
	env := read(t, h.out, "env.txt")
	for _, bad := range []string{"KUBECONFIG", "KUBEBAY_TOKEN", "launch-secret", "AWS_", "GITHUB_TOKEN", "run-token-abc"} {
		if strings.Contains(env, bad) {
			t.Errorf("child env contains %q", bad)
		}
	}
	args := read(t, h.out, "args.txt")
	if strings.Contains(args, "run-token-abc") {
		t.Fatal("run token in argv")
	}
	if !strings.Contains(args, "--strict-mcp-config") || !strings.Contains(args, "--restricted") {
		t.Fatalf("argv: %s", args)
	}
	if !strings.Contains(read(t, h.out, "cfg.txt"), "Bearer run-token-abc") {
		t.Fatal("run token missing from the MCP config")
	}
	if h.mints != 1 || h.revs != 1 {
		t.Fatalf("mint/revoke = %d/%d", h.mints, h.revs)
	}
}

func TestRunStreamsTextAndToolNamesOnly(t *testing.T) {
	h := newHarness(t, "info")
	inv, _ := h.m.Start("local", req)
	h.wait(t, inv)
	evs, _ := inv.Wait(context.Background(), 0)
	var text, tools []string
	for _, e := range evs {
		switch e.Kind {
		case "text":
			text = append(text, e.Text)
		case "tool":
			tools = append(tools, e.Text)
		}
		if strings.Contains(e.Text, "hidden") {
			t.Fatalf("tool input forwarded: %v", e)
		}
	}
	if len(text) != 1 || text[0] != "hello" || len(tools) != 1 || tools[0] != "mcp__kubebay__list_clusters" {
		t.Fatalf("events: %+v", evs)
	}
}

func TestRunAuditHasNoPromptOrOutput(t *testing.T) {
	h := newHarness(t, "info")
	inv, _ := h.m.Start("alice", req)
	h.wait(t, inv)
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.audit) != 2 {
		t.Fatalf("want start and end entries, got %+v", h.audit)
	}
	for _, e := range h.audit {
		if e.Action != "ai-investigation" || e.User != "alice" || e.Cluster != "c1" {
			t.Fatalf("entry %+v", e)
		}
		for _, bad := range []string{"back-off restarting", "hello", "run-token"} {
			if strings.Contains(e.Detail, bad) {
				t.Fatalf("audit detail leaks %q: %q", bad, e.Detail)
			}
		}
	}
	if !strings.Contains(h.audit[1].Detail, "outcome=done") {
		t.Fatalf("end entry: %q", h.audit[1].Detail)
	}
}

func TestStopKillsAProcessThatIgnoresSIGTERM(t *testing.T) {
	h := newHarness(t, "trap")
	inv, _ := h.m.Start("local", req)
	waitFor(t, func() bool { _, err := os.Stat(filepath.Join(h.out, "ready")); return err == nil })
	start := time.Now()
	inv.Stop()
	if got := h.wait(t, inv); got != "stopped" {
		t.Fatalf("outcome %q", got)
	}
	if time.Since(start) > 4*time.Second {
		t.Fatal("stop took too long")
	}
	if h.revs != 1 {
		t.Fatal("token not revoked after stop")
	}
}

func TestTimeoutKillsTheRun(t *testing.T) {
	h := newHarness(t, "sleep")
	h.m.Limits.Wall = 400 * time.Millisecond
	inv, _ := h.m.Start("local", req)
	if got := h.wait(t, inv); got != "timeout" {
		t.Fatalf("outcome %q", got)
	}
	if h.revs != 1 {
		t.Fatal("token not revoked after timeout")
	}
}

func TestNoOrphanGrandchild(t *testing.T) {
	h := newHarness(t, "fork")
	inv, _ := h.m.Start("local", req)
	waitFor(t, func() bool { _, err := os.Stat(filepath.Join(h.out, "ready")); return err == nil })
	pid := atoi(t, strings.TrimSpace(read(t, h.out, "child.pid")))
	inv.Stop()
	h.wait(t, inv)
	waitFor(t, func() bool { return syscall.Kill(pid, 0) != nil })
}

func TestOutputCapStopsTheRun(t *testing.T) {
	h := newHarness(t, "flood")
	inv, _ := h.m.Start("local", req)
	if got := h.wait(t, inv); got != "limit" {
		t.Fatalf("outcome %q", got)
	}
	evs, _ := inv.Wait(context.Background(), 0)
	total := 0
	for _, e := range evs {
		if e.Kind == "text" {
			total += len(e.Text)
		}
	}
	if total > 4096 {
		t.Fatalf("forwarded %d bytes past the cap", total)
	}
}

func TestCrashReportsStderrTail(t *testing.T) {
	h := newHarness(t, "crash")
	inv, _ := h.m.Start("local", req)
	if got := h.wait(t, inv); got != "error" {
		t.Fatalf("outcome %q", got)
	}
	evs, _ := inv.Wait(context.Background(), 0)
	found := false
	for _, e := range evs {
		if e.Kind == "notice" && strings.Contains(e.Text, "Not logged in") {
			found = true
		}
	}
	if !found {
		t.Fatalf("stderr not reported: %+v", evs)
	}
}

func TestOneRunPerUserAndShutdown(t *testing.T) {
	h := newHarness(t, "sleep")
	inv, err := h.m.Start("local", req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.m.Start("local", req); err != ErrBusy {
		t.Fatalf("want ErrBusy, got %v", err)
	}
	h.m.Shutdown()
	if got := h.wait(t, inv); got != "stopped" {
		t.Fatalf("outcome %q", got)
	}
}

func TestNoClaudeStartsNothing(t *testing.T) {
	h := newHarness(t, "info")
	h.m.Claude = ""
	if _, err := h.m.Start("local", req); err != ErrNoClaude {
		t.Fatalf("want ErrNoClaude, got %v", err)
	}
	if h.mints != 0 {
		t.Fatal("a token was minted with no claude to run")
	}
}

func TestMintFailureStartsNothing(t *testing.T) {
	h := newHarness(t, "info")
	h.m.Mint = func(string, string, time.Duration) (string, func(), error) { return "", nil, os.ErrPermission }
	if _, err := h.m.Start("local", req); err == nil {
		t.Fatal("want an error")
	}
	if entries, _ := os.ReadDir(h.root); len(entries) != 0 {
		t.Fatalf("temp dir left: %v", entries)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if cond() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("condition not met")
}

func atoi(t *testing.T, s string) int {
	t.Helper()
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}
