package main

import (
	"os"
	"path/filepath"

	"github.com/RajaSardar/kubebay/engine/internal/sigcheck"
)

// sigstoreTrustRoots keeps Sigstore's TUF metadata and the last verified
// trusted root under ~/.kubebay/sigstore. Without a writable home (some
// in-cluster images), nothing is kept on disk and every load goes to TUF.
func sigstoreTrustRoots() *sigcheck.TrustRoots {
	tr := &sigcheck.TrustRoots{}
	if home, err := os.UserHomeDir(); err == nil {
		dir := filepath.Join(home, ".kubebay", "sigstore")
		if os.MkdirAll(dir, 0o700) == nil {
			tr.Dir = dir
		}
	}
	return tr
}
