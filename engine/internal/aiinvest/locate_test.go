package aiinvest

import (
	"os"
	"path/filepath"
	"testing"
)

func exe(t *testing.T, dir, name string, mode os.FileMode) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"), mode); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestFindPathFirstThenCommon(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	onPath := exe(t, a, "claude", 0o755)
	common := exe(t, b, "claude", 0o755)
	if got := Find(a, []string{common}); got != onPath {
		t.Fatalf("PATH must win: %q", got)
	}
	empty := t.TempDir()
	if got := Find(empty, []string{common}); got != common {
		t.Fatalf("common path fallback: %q", got)
	}
}

func TestFindSkipsNonExecutableDirsAndRelative(t *testing.T) {
	a := t.TempDir()
	exe(t, a, "claude", 0o644)
	if err := os.Mkdir(filepath.Join(t.TempDir(), "claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	d := t.TempDir()
	_ = os.Mkdir(filepath.Join(d, "claude"), 0o755)
	if got := Find(a+string(os.PathListSeparator)+d+string(os.PathListSeparator)+"relative/dir", []string{"claude", filepath.Join(d, "claude")}); got != "" {
		t.Fatalf("want nothing, got %q", got)
	}
}

func TestCommonPaths(t *testing.T) {
	got := CommonPaths("/Users/x")
	want := "/Users/x/.claude/local/claude"
	found := false
	for _, p := range got {
		if p == want {
			found = true
		}
		if !filepath.IsAbs(p) {
			t.Errorf("relative candidate %q", p)
		}
	}
	if !found {
		t.Fatalf("%q missing from %v", want, got)
	}
}
