package aiinvest

import (
	"os"
	"os/exec"
	"testing"
)

// The desktop app ships for Windows too, and the release builds the engine for
// every target: process-group handling must not leak Unix-only syscalls into
// code that Windows compiles (v0.8.3's first release run failed on exactly that).
func TestPackageCompilesForEveryReleaseTarget(t *testing.T) {
	if testing.Short() {
		t.Skip("cross-compiling is slow")
	}
	goBin, err := exec.LookPath("go")
	if err != nil {
		t.Skip("no go tool on PATH")
	}
	for _, goos := range []string{"windows", "darwin", "linux"} {
		t.Run(goos, func(t *testing.T) {
			cmd := exec.Command(goBin, "build", "-o", os.DevNull, ".")
			cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS="+goos, "GOARCH=amd64")
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("GOOS=%s go build: %v\n%s", goos, err, out)
			}
		})
	}
}
