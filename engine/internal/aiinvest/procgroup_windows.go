//go:build windows

package aiinvest

import (
	"os/exec"
	"strconv"
)

// Windows has no process groups to signal. taskkill /T ends the child and the
// tree below it; /F is needed because a console program ignores a polite stop.
func inOwnGroup(cmd *exec.Cmd) {}

func terminateGroup(pid int) { killGroup(pid) }

func killGroup(pid int) {
	_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid)).Run()
}
