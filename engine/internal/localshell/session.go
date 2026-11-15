//go:build localshell

// Package localshell runs a PTY on the machine hosting the engine, so that a
// terminal in Kubebay is the user's own shell with the user's own kubeconfig,
// rather than an exec into a pod running as some ServiceAccount.
//
// The whole package is behind the "localshell" build tag; see localshell_off.go
// for why it must not exist in shipped binaries.
package localshell

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/creack/pty"
)

var (
	// ErrDisabled means the feature is compiled in but must not run here.
	ErrDisabled = errors.New("local shell is disabled")
	// ErrUnsupported means the platform has no PTY support (Windows).
	ErrUnsupported = errors.New("local shell is not supported on this platform")
)

const (
	lockName = ".lock"
	// Output pacing.  Sleeping in the read loop lets the PTY buffer fill, which
	// pushes back on the shell itself, so `cat /dev/urandom` throttles at the
	// source instead of flooding the WebSocket.
	outChunk      = 16 << 10
	outRateBps    = 2 << 20
	shutdownGrace = 2 * time.Second
	resizeDepth   = 16
)

// Allowed reports whether a local shell may be served in this deployment.
//
// oidcEnabled is not in the original design's signature but has to be: the
// session kubeconfig carries no impersonation, so in an authenticated
// deployment every logged-in user would get a shell running as the engine's
// own identity, straight past the impersonation audit trail.
func Allowed(enabled, inCluster, oidcEnabled bool, addr string) error {
	if !enabled {
		return ErrDisabled
	}
	if inCluster {
		return fmt.Errorf("%w: --in-cluster means the engine is not on the user's machine", ErrDisabled)
	}
	if oidcEnabled {
		return fmt.Errorf("%w: OIDC is configured, and a local shell would run as the engine's identity for every logged-in user", ErrDisabled)
	}
	return loopbackOnly(addr)
}

func loopbackOnly(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("%w: cannot parse listen address %q: %v", ErrDisabled, addr, err)
	}
	if host == "" {
		return fmt.Errorf("%w: listen address %q binds every interface", ErrDisabled, addr)
	}
	if host == "localhost" {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("%w: listen address %q is not loopback", ErrDisabled, addr)
}

// Manager owns one instance directory for the lifetime of the engine process.
type Manager struct {
	log  *slog.Logger
	root string
	lock *os.File
}

func instanceBase() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "kubebay", "local-shell"), nil
}

func NewManager(log *slog.Logger) (*Manager, error) {
	base, err := instanceBase()
	if err != nil {
		return nil, fmt.Errorf("local shell: config dir: %w", err)
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		return nil, fmt.Errorf("local shell: %w", err)
	}
	// Sweep before claiming our own directory so we can never sweep ourselves.
	sweep(log, base, "")
	root, err := os.MkdirTemp(base, "inst-")
	if err != nil {
		return nil, fmt.Errorf("local shell: instance dir: %w", err)
	}
	lock, err := tryLock(filepath.Join(root, lockName))
	if err != nil {
		_ = os.RemoveAll(root)
		return nil, fmt.Errorf("local shell: lock: %w", err)
	}
	return &Manager{log: log, root: root, lock: lock}, nil
}

func (m *Manager) Close() error {
	if m == nil {
		return nil
	}
	if m.lock != nil {
		_ = m.lock.Close()
	}
	return os.RemoveAll(m.root)
}

// Size is a terminal geometry update.
type Size struct{ Cols, Rows uint16 }

// Options describes one shell session.  There is deliberately no argv here.
type Options struct {
	Cluster         string
	Context         string
	KubeconfigPaths []string
	Shell           string // resolved by ResolveShell; filled in when empty
	Cols, Rows      uint16
}

// IO wires the session to the WebSocket channel.
type IO struct {
	Write  func([]byte) error
	Stdin  io.Reader
	Resize <-chan Size
}

// Outcome is what the audit record is built from.
type Outcome struct {
	Shell    string
	Context  string
	ExitCode int
	Duration time.Duration
}

// Open runs a shell attached to a PTY and pumps it until the process exits or
// ctx is cancelled.  It blocks, mirroring the k8s exec bridge.
func (m *Manager) Open(ctx context.Context, opts Options, ios IO) (out Outcome, err error) {
	start := time.Now()
	out = Outcome{Context: opts.Context, Shell: opts.Shell, ExitCode: -1}
	// Named results: the audit record on close needs the duration on every path.
	defer func() { out.Duration = time.Since(start) }()

	if m == nil || m.root == "" {
		return out, ErrDisabled
	}

	shell := opts.Shell
	if shell == "" {
		var err error
		if shell, err = ResolveShell(); err != nil {
			return out, err
		}
	}
	out.Shell = shell

	// The session directory name is generated here, never derived from the
	// client-chosen channel id: "../../../.zshrc" as a filename would be an
	// arbitrary 0600 file write.
	dir, err := os.MkdirTemp(m.root, "s-")
	if err != nil {
		return out, fmt.Errorf("session dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(dir) }()

	kubeconfig, err := writeSessionKubeconfig(dir, opts.Context)
	if err != nil {
		return out, err
	}

	cols, rows := opts.Cols, opts.Rows
	if cols == 0 || rows == 0 {
		cols, rows = 80, 24
	}

	cmd := exec.Command(shell)
	cmd.Env = append(withoutEnv(os.Environ(), "KUBECONFIG"),
		"KUBECONFIG="+kubeconfigEnv(kubeconfig, opts.KubeconfigPaths),
		"TERM=xterm-256color",
		"KUBEBAY_LOCAL_SHELL=1",
	)
	if home, herr := os.UserHomeDir(); herr == nil {
		cmd.Dir = home
	}

	ptmx, err := startPTY(cmd, cols, rows)
	if err != nil {
		return out, fmt.Errorf("start %s: %w", shell, err)
	}

	outDone := make(chan struct{})
	go func() {
		defer close(outDone)
		pumpOutput(ptmx, ios.Write)
	}()
	go func() { _, _ = io.Copy(ptmx, ios.Stdin) }()
	go resizeLoop(ctx, ptmx, ios.Resize)

	select {
	case <-ctx.Done():
	case <-outDone: // PTY hung up: the shell and every holder of the tty are gone
	}

	// terminateGroup signals before reaping, so the child is still unreaped and
	// its pid — and therefore the process group id — cannot have been recycled.
	waitErr := terminateGroup(cmd, shutdownGrace)
	_ = ptmx.Close()
	<-outDone

	var ee *exec.ExitError
	switch {
	case waitErr == nil:
		out.ExitCode = 0
	case errors.As(waitErr, &ee):
		out.ExitCode = ee.ExitCode()
	}
	if cerr := ctx.Err(); cerr != nil {
		return out, cerr
	}
	return out, nil
}

func resizeLoop(ctx context.Context, ptmx *os.File, in <-chan Size) {
	for {
		select {
		case <-ctx.Done():
			return
		case s, ok := <-in:
			if !ok {
				return
			}
			if s.Cols > 0 && s.Rows > 0 {
				_ = pty.Setsize(ptmx, &pty.Winsize{Cols: s.Cols, Rows: s.Rows})
			}
		}
	}
}

// pumpOutput copies PTY output to the channel with a token-bucket rate limit.
func pumpOutput(r io.Reader, write func([]byte) error) {
	buf := make([]byte, outChunk)
	budget := float64(outRateBps)
	last := time.Now()
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if werr := write(buf[:n]); werr != nil {
				return
			}
			now := time.Now()
			budget = min(budget+now.Sub(last).Seconds()*outRateBps, outRateBps)
			last = now
			if budget -= float64(n); budget < 0 {
				time.Sleep(time.Duration(-budget / outRateBps * float64(time.Second)))
				budget, last = 0, time.Now()
			}
		}
		if err != nil {
			return
		}
	}
}

// ResolveShell picks the shell from the engine's own environment, never from
// the client.  $SHELL is honoured only when /etc/shells lists it, so neither a
// poisoned environment nor a client frame can turn "open a shell" into "run
// this program".
func ResolveShell() (string, error) {
	if s := strings.TrimSpace(os.Getenv("SHELL")); s != "" && listedInEtcShells(s) && executable(s) {
		return s, nil
	}
	for _, candidate := range []string{"/bin/bash", "/bin/sh"} {
		if executable(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("no usable shell found")
}

func listedInEtcShells(path string) bool {
	b, err := os.ReadFile("/etc/shells")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(b), "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "#") && line == path {
			return true
		}
	}
	return false
}

func executable(path string) bool {
	if !filepath.IsAbs(path) {
		return false
	}
	st, err := os.Stat(path)
	return err == nil && st.Mode().IsRegular() && st.Mode().Perm()&0o111 != 0
}

func withoutEnv(env []string, key string) []string {
	out := env[:0:0]
	for _, kv := range env {
		if !strings.HasPrefix(kv, key+"=") {
			out = append(out, kv)
		}
	}
	return out
}
