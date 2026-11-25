package rolloutsdash

import (
	"os"
	"os/exec"
	"testing"
)

// The release builds the engine for every desktop target; Unix-only syscalls
// must stay in the !windows file.
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
