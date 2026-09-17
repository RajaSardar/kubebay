//go:build localshell && unix

package localshell

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestSweepRemovesOnlyUnlockedInstances(t *testing.T) {
	base := t.TempDir()
	live := filepath.Join(base, "inst-live")
	dead := filepath.Join(base, "inst-dead")
	for _, d := range []string{live, dead} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(d, "marker"), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	// A live engine holds its lock for its whole lifetime.
	held, err := tryLock(filepath.Join(live, lockName))
	if err != nil {
		t.Fatalf("lock live dir: %v", err)
	}
	defer held.Close()

	// The dead one has a lock file nobody holds — what a SIGKILLed engine
	// leaves behind, since the kernel drops the flock when the fd closes.
	f, err := tryLock(filepath.Join(dead, lockName))
	if err != nil {
		t.Fatalf("lock dead dir: %v", err)
	}
	_ = f.Close()

	sweep(quietLogger(), base, "")

	if _, err := os.Stat(live); err != nil {
		t.Fatalf("locked instance dir was removed: %v", err)
	}
	if _, err := os.Stat(dead); !os.IsNotExist(err) {
		t.Fatalf("orphaned instance dir survived: %v", err)
	}
}

func TestSweepSkipsNamedDir(t *testing.T) {
	base := t.TempDir()
	mine := filepath.Join(base, "inst-mine")
	if err := os.MkdirAll(mine, 0o700); err != nil {
		t.Fatal(err)
	}
	sweep(quietLogger(), base, "inst-mine")
	if _, err := os.Stat(mine); err != nil {
		t.Fatalf("skipped dir was removed: %v", err)
	}
}
