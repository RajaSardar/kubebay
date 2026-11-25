//go:build !windows

package rolloutsdash

import (
	"os/exec"
	"syscall"
)

// inOwnGroup starts the child in its own process group so one signal reaches it
// and anything it forks (a kubeconfig exec plugin, for one).
func inOwnGroup(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }

func terminateGroup(pid int) { _ = syscall.Kill(-pid, syscall.SIGTERM) }

func killGroup(pid int) { _ = syscall.Kill(-pid, syscall.SIGKILL) }

// pidAlive reports whether pid is a live process (signal 0 checks, sends nothing).
func pidAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
