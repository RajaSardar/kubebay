//go:build localshell && windows

package localshell

import (
	"os"
	"os/exec"
	"time"
)

// windows/amd64 is a release target, built with CGO_ENABLED=0, so these have to
// compile and cannot pull in a PTY implementation.  ConPTY has no process-group
// teardown equivalent to kill(-pgid), so the feature is simply unavailable.

func startPTY(*exec.Cmd, uint16, uint16) (*os.File, error) { return nil, ErrUnsupported }

func terminateGroup(*exec.Cmd, time.Duration) error { return ErrUnsupported }

func tryLock(string) (*os.File, error) { return nil, ErrUnsupported }
