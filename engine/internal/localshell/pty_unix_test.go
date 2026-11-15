//go:build localshell && unix

package localshell

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func requirePTY(t *testing.T) {
	t.Helper()
	if _, err := os.Stat("/dev/ptmx"); err != nil {
		t.Skip("no /dev/ptmx on this machine")
	}
}

func TestTerminateGroupKillsBackgroundedChildren(t *testing.T) {
	requirePTY(t)

	cmd := exec.Command("/bin/sh", "-c", "echo hi; sleep 30")
	ptmx, err := startPTY(cmd, 80, 24)
	if err != nil {
		t.Fatalf("startPTY: %v", err)
	}

	pid := cmd.Process.Pid
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		t.Fatalf("getpgid: %v", err)
	}
	// pty.StartWithSize sets Setsid, so the shell leads its own group.  That is
	// the whole basis for killing the negative pid.
	if pgid != pid {
		t.Fatalf("pgid %d != pid %d — the shell is not a session leader", pgid, pid)
	}

	got := make(chan []byte, 1)
	go func() {
		buf := make([]byte, 256)
		n, _ := ptmx.Read(buf)
		got <- buf[:n]
	}()
	select {
	case b := <-got:
		if !bytes.Contains(b, []byte("hi")) {
			t.Fatalf("read %q, want it to contain %q", b, "hi")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("no PTY output within 10s")
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = terminateGroup(cmd, shutdownGrace)
	}()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("terminateGroup did not return")
	}
	_ = ptmx.Close()

	// The whole group must be gone, not just the leader: a backgrounded
	// `kubectl port-forward` would be a sibling in this group.
	deadline := time.Now().Add(5 * time.Second)
	for {
		err := syscall.Kill(-pgid, 0)
		if errors.Is(err, syscall.ESRCH) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("process group %d still alive (kill returned %v)", pgid, err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("leader pid %d still alive (kill returned %v)", pid, err)
	}
}

func TestManagerOpenStreamsAndCleansUp(t *testing.T) {
	requirePTY(t)

	base := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", base)
	if d, err := os.UserConfigDir(); err != nil || !strings.HasPrefix(d, base) {
		t.Skip("UserConfigDir is not redirectable on this platform")
	}

	m, err := NewManager(quietLogger())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.Close()

	var mu sync.Mutex
	var seen bytes.Buffer
	bytesIn := make(chan struct{}, 1)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pr, pw := io.Pipe()
	defer pw.Close()

	type result struct {
		out Outcome
		err error
	}
	resCh := make(chan result, 1)
	go func() {
		out, err := m.Open(ctx, Options{Context: "unit-test-ctx", Cols: 100, Rows: 30}, IO{
			Write: func(b []byte) error {
				mu.Lock()
				seen.Write(b)
				mu.Unlock()
				select {
				case bytesIn <- struct{}{}:
				default:
				}
				return nil
			},
			Stdin:  pr,
			Resize: make(chan Size),
		})
		resCh <- result{out, err}
	}()

	if _, err := pw.Write([]byte("echo kubebay-marker\n")); err != nil {
		t.Fatalf("stdin: %v", err)
	}
	select {
	case <-bytesIn:
	case <-time.After(15 * time.Second):
		t.Fatal("no shell output within 15s")
	}

	cancel()
	select {
	case r := <-resCh:
		if !errors.Is(r.err, context.Canceled) {
			t.Fatalf("Open err = %v, want context.Canceled", r.err)
		}
		if r.out.Shell == "" {
			t.Fatal("outcome carries no shell path")
		}
		if r.out.Context != "unit-test-ctx" {
			t.Fatalf("outcome context = %q", r.out.Context)
		}
		if r.out.Duration <= 0 {
			t.Fatal("outcome carries no duration")
		}
	case <-time.After(20 * time.Second):
		t.Fatal("Open did not return after cancel")
	}

	// The per-session directory, and the kubeconfig in it, are gone.
	entries, err := os.ReadDir(m.root)
	if err != nil {
		t.Fatalf("read instance dir: %v", err)
	}
	for _, e := range entries {
		if e.Name() != lockName {
			t.Fatalf("session leftover in instance dir: %s", e.Name())
		}
	}
}

func TestResolveShellIgnoresUnlistedEnv(t *testing.T) {
	t.Setenv("SHELL", "/usr/bin/definitely-not-a-shell")
	got, err := ResolveShell()
	if err != nil {
		t.Fatalf("ResolveShell: %v", err)
	}
	if got != "/bin/bash" && got != "/bin/sh" {
		t.Fatalf("ResolveShell = %q, want a fallback shell", got)
	}
}

func TestResolveShellRejectsRelativePath(t *testing.T) {
	t.Setenv("SHELL", "sh")
	got, err := ResolveShell()
	if err != nil {
		t.Fatalf("ResolveShell: %v", err)
	}
	if got == "sh" {
		t.Fatal("ResolveShell accepted a relative $SHELL")
	}
}
