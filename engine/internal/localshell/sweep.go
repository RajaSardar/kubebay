//go:build localshell

package localshell

import (
	"log/slog"
	"os"
	"path/filepath"
)

// sweep removes instance directories whose owning engine is gone.
//
// Liveness is decided by flock, never by a recorded pid.  Each engine holds
// LOCK_EX|LOCK_NB on its own .lock for its whole lifetime, and the kernel drops
// that lock when the process dies — including under SIGKILL, where no cleanup
// code of ours runs.  Taking the lock therefore proves the owner is gone;
// EWOULDBLOCK proves it is alive.  A pid file would be worse than useless here:
// pids are recycled, so a stale one eventually names an unrelated live process
// and we would keep the directory forever (or, if we killed it, kill a stranger).
func sweep(log *slog.Logger, base, skip string) {
	entries, err := os.ReadDir(base)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() || e.Name() == skip {
			continue
		}
		dir := filepath.Join(base, e.Name())
		f, err := tryLock(filepath.Join(dir, lockName))
		if err != nil {
			continue // held by a live engine, or not ours to touch
		}
		_ = f.Close()
		if err := os.RemoveAll(dir); err != nil {
			log.Warn("local shell: could not remove orphaned instance dir", "dir", dir, "err", err)
			continue
		}
		log.Info("local shell: removed orphaned instance dir", "dir", dir)
	}
}
