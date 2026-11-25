//go:build !windows

package aiinvest

import (
	"os/exec"
	"syscall"
)

// inOwnGroup starts the child in its own process group, so one signal reaches
// it and everything it forks.
func inOwnGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// terminateGroup asks the child's whole group to stop.
func terminateGroup(pid int) { _ = syscall.Kill(-pid, syscall.SIGTERM) }

// killGroup stops the child's whole group at once.
func killGroup(pid int) { _ = syscall.Kill(-pid, syscall.SIGKILL) }
