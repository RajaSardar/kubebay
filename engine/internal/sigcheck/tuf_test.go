package sigcheck

import (
	"context"
	"crypto"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sigstore/sigstore/pkg/signature"
	"github.com/theupdateframework/go-tuf/v2/metadata"
)

// tufRepo serves a one-target TUF repository (consistent snapshots, as
// Sigstore's is) whose trusted_root.json target is signed for, then serves
// served instead, so a test can swap in tampered content.
type tufRepo struct {
	srv    *httptest.Server
	root   []byte
	files  map[string][]byte
	served []byte
	hits   int
}

func newTUFRepo(t *testing.T, trustedRoot []byte) *tufRepo {
	t.Helper()
	exp := time.Now().Add(30 * 24 * time.Hour)
	root, targets, snapshot, timestamp := metadata.Root(exp), metadata.Targets(exp), metadata.Snapshot(exp), metadata.Timestamp(exp)
	tf, err := metadata.TargetFile().FromBytes("trusted_root.json", trustedRoot, "sha256")
	if err != nil {
		t.Fatal(err)
	}
	targets.Signed.Targets["trusted_root.json"] = tf
	root.Signed.ConsistentSnapshot = true
	signers := map[string]signature.Signer{}
	for _, role := range []string{"root", "targets", "snapshot", "timestamp"} {
		_, priv, _ := ed25519.GenerateKey(nil)
		k, err := metadata.KeyFromPublicKey(priv.Public())
		if err != nil {
			t.Fatal(err)
		}
		if err := root.Signed.AddKey(k, role); err != nil {
			t.Fatal(err)
		}
		signers[role], _ = signature.LoadSigner(priv, crypto.Hash(0))
	}
	r := &tufRepo{files: map[string][]byte{}, served: trustedRoot}
	put := func(name string, b []byte, err error) {
		if err != nil {
			t.Fatal(err)
		}
		r.files[name] = b
	}
	for role, s := range signers {
		var err error
		switch role {
		case "root":
			_, err = root.Sign(s)
		case "targets":
			_, err = targets.Sign(s)
		case "snapshot":
			_, err = snapshot.Sign(s)
		case "timestamp":
			_, err = timestamp.Sign(s)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	b, err := root.ToBytes(false)
	put("1.root.json", b, err)
	r.root = b
	b, err = targets.ToBytes(false)
	put("1.targets.json", b, err)
	b, err = snapshot.ToBytes(false)
	put("1.snapshot.json", b, err)
	b, err = timestamp.ToBytes(false)
	put("timestamp.json", b, err)
	hash := tf.Hashes["sha256"].String()
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.hits++
		name := strings.TrimPrefix(req.URL.Path, "/")
		if name == "targets/"+hash+".trusted_root.json" {
			_, _ = w.Write(r.served)
			return
		}
		if b, ok := r.files[name]; ok {
			_, _ = w.Write(b)
			return
		}
		http.NotFound(w, req)
	}))
	t.Cleanup(r.srv.Close)
	return r
}

func TestTrustRootsComeThroughTUFAndAreReused(t *testing.T) {
	want, _ := os.ReadFile("testdata/trusted_root.json")
	repo := newTUFRepo(t, want)
	dir := t.TempDir()
	tr := &TrustRoots{Remote: repo.srv.URL, Dir: dir, InitialRoot: repo.root}
	r, from, err := tr.Get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(r.CAs) != 2 || from != "TUF" {
		t.Errorf("root = %d CAs, from %q", len(r.CAs), from)
	}
	hits := repo.hits
	if _, _, err := tr.Get(context.Background()); err != nil || repo.hits != hits {
		t.Errorf("a loaded root is reused for a day: %v, %d more requests", err, repo.hits-hits)
	}
	if b, err := os.ReadFile(filepath.Join(dir, "trusted_root.json")); err != nil || string(b) != string(want) {
		t.Errorf("the verified copy is kept for offline use: %v", err)
	}
}

// Offline, the last copy TUF verified is used, and says so.
func TestTrustRootsFallBackToTheVerifiedCopy(t *testing.T) {
	want, _ := os.ReadFile("testdata/trusted_root.json")
	repo := newTUFRepo(t, want)
	dir := t.TempDir()
	if _, _, err := (&TrustRoots{Remote: repo.srv.URL, Dir: dir, InitialRoot: repo.root}).Get(context.Background()); err != nil {
		t.Fatal(err)
	}
	repo.srv.Close()
	r, from, err := (&TrustRoots{Remote: repo.srv.URL, Dir: dir, InitialRoot: repo.root}).Get(context.Background())
	if err != nil || len(r.CAs) != 2 || !strings.HasPrefix(from, "cached copy") {
		t.Errorf("offline: %v from %q", err, from)
	}
}

func TestTrustRootsRejectTamperedTargets(t *testing.T) {
	want, _ := os.ReadFile("testdata/trusted_root.json")
	repo := newTUFRepo(t, want)
	repo.served = []byte(strings.Replace(string(want), "rekor.sigstore.dev", "rekor.evil.example", 1))
	dir := t.TempDir()
	if _, _, err := (&TrustRoots{Remote: repo.srv.URL, Dir: dir, InitialRoot: repo.root}).Get(context.Background()); err == nil {
		t.Fatal("a target that doesn't match the signed metadata must be refused")
	}
	if _, err := os.Stat(filepath.Join(dir, "trusted_root.json")); err == nil {
		t.Error("nothing unverified is cached")
	}
}

func TestTrustRootsWithNothingCachedAndNoNetworkSaySo(t *testing.T) {
	repo := newTUFRepo(t, []byte("{}"))
	repo.srv.Close()
	_, _, err := (&TrustRoots{Remote: repo.srv.URL, Dir: t.TempDir(), InitialRoot: repo.root}).Get(context.Background())
	if err == nil || !strings.Contains(err.Error(), "TUF") {
		t.Errorf("err = %v", err)
	}
}

func TestTheEmbeddedRootIsSigstoresTUFRoot(t *testing.T) {
	var m struct {
		Signed struct {
			Type    string `json:"_type"`
			Version int    `json:"version"`
		} `json:"signed"`
	}
	if err := json.Unmarshal(sigstoreTUFRoot, &m); err != nil || m.Signed.Type != "root" || m.Signed.Version < 1 {
		t.Errorf("embedded root: %+v %v", m, err)
	}
	if (&TrustRoots{}).remote() != "https://tuf-repo-cdn.sigstore.dev" {
		t.Error("default remote")
	}
}
