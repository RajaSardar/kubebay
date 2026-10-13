package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSigstoreTrustRootsAreKeptUnderKubebaysDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	tr := sigstoreTrustRoots()
	want := filepath.Join(home, ".kubebay", "sigstore")
	if st, err := os.Stat(want); tr.Dir != want || err != nil || st.Mode().Perm() != 0o700 {
		t.Errorf("dir = %q (%v)", tr.Dir, err)
	}
	if tr.Remote != "" {
		t.Error("Sigstore's public TUF repository by default")
	}
}
