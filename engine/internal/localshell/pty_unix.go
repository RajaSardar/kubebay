//go:build localshell && unix

package localshell

import (
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// startPTY starts cmd on a new pseudo-terminal.  pty.StartWithSize sets
// Setsid+Setctty, so the shell becomes a session leader whose process group id
// equals its pid — which is what makes terminateGroup's negative-pid kill work.
func startPTY(cmd *exec.Cmd, cols, rows uint16) (*os.File, error) {
	return pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
}

// terminateGroup tears down the shell's whole process group: SIGHUP, a grace
// period, then SIGKILL.  The negative pid is the point — a `kubectl
// port-forward` the user backgrounded inside the shell is in the same group and
// would otherwise outlive the terminal, holding a local port open.
//
// cmd.Wait is called only after the first signal: while the child is unreaped
// its pid cannot be recycled, so neither can the group id we are signalling.
func terminateGroup(cmd *exec.Cmd, grace time.Duration) error {
	if cmd.Process == nil {
		return nil
	}
	pid := cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGHUP)

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-time.After(grace):
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		return <-done
	}
}

// tryLock takes an exclusive, non-blocking flock and hands back the open file:
// the lock lives as long as the descriptor, so the caller must hold it.
func tryLock(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}
