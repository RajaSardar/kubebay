//go:build windows

package rolloutsdash

import (
	"os/exec"
	"strconv"
)

// Windows has no process groups to signal; taskkill /T ends the tree.
func inOwnGroup(cmd *exec.Cmd) {}

func terminateGroup(pid int) { killGroup(pid) }

func killGroup(pid int) {
	_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid)).Run()
}

// pidAlive is false: the orphan sweep is a Unix-only safety net (a pid file
// cannot prove a Windows pid is still ours).
func pidAlive(pid int) bool { return false }
