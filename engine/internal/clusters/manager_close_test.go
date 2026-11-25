package clusters

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A Manager owns a file watcher (one inotify instance on Linux, and a process
// may have only 128) and a health loop. Tests make many managers; without Close
// the CI run for v0.8.3 died with "too many open files".
func TestCloseReleasesTheWatcherAndStopsTheLoops(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "kubeconfig")
	cfg := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://127.0.0.1:1\ncontexts:\n- name: kind-dev\n  context:\n    cluster: c\n    user: u\nusers:\n- name: u\n  user: {}\ncurrent-context: kind-dev\n"
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	m.Close()
	m.Close() // idempotent
	select {
	case _, ok := <-m.watcher.Events:
		if ok {
			t.Fatal("watcher still delivering events after Close")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("watcher was not closed")
	}
	select {
	case <-m.loopsDone:
	case <-time.After(2 * time.Second):
		t.Fatal("health loop and file watcher goroutines did not stop")
	}
}
