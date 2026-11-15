package sigcheck

import (
	"context"
	_ "embed"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/theupdateframework/go-tuf/v2/metadata/config"
	"github.com/theupdateframework/go-tuf/v2/metadata/updater"
)

// sigstoreTUFRoot is the root of trust for Sigstore's public TUF repository,
// as sigstore-go ships it. TUF walks from it to the current root, so an old
// one only costs a few extra fetches.
//
//go:embed sigstore-tuf-root.json
var sigstoreTUFRoot []byte

const sigstoreTUF = "https://tuf-repo-cdn.sigstore.dev"

// TrustRoots loads Sigstore's trusted root (trusted_root.json) through TUF,
// which checks it is the current one Sigstore signed. The last copy TUF
// verified is kept on disk and used when the repository can't be reached.
type TrustRoots struct {
	// Remote is the TUF repository (Sigstore's public one when empty).
	Remote string
	// Dir holds the TUF metadata and the last verified trusted root.
	Dir string
	// InitialRoot is the TUF root of trust (Sigstore's when empty).
	InitialRoot []byte
	Client      *http.Client
	// TTL is how long a loaded root is used before TUF is asked again.
	TTL time.Duration

	mu   sync.Mutex
	root *TrustedRoot
	from string
	next time.Time
}

func (t *TrustRoots) remote() string {
	if t.Remote != "" {
		return t.Remote
	}
	return sigstoreTUF
}

func (t *TrustRoots) copyPath() string { return filepath.Join(t.Dir, "trusted_root.json") }

// Get returns the trusted root and where it came from: "TUF", or "cached
// copy from <date>" when the repository couldn't be reached.
func (t *TrustRoots) Get(_ context.Context) (*TrustedRoot, string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	if t.root != nil && now.Before(t.next) {
		return t.root, t.from, nil
	}
	ttl := t.TTL
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	b, err := t.fetch()
	if err == nil {
		r, perr := ParseTrustedRoot(b)
		if perr == nil {
			if t.Dir != "" {
				tmp := t.copyPath() + ".tmp"
				if os.WriteFile(tmp, b, 0o600) == nil {
					_ = os.Rename(tmp, t.copyPath())
				}
			}
			t.root, t.from, t.next = r, "TUF", now.Add(ttl)
			return r, t.from, nil
		}
		err = perr
	}
	if t.Dir != "" {
		if b, rerr := os.ReadFile(t.copyPath()); rerr == nil {
			if r, perr := ParseTrustedRoot(b); perr == nil {
				from := "cached copy"
				if st, serr := os.Stat(t.copyPath()); serr == nil {
					from += " from " + st.ModTime().UTC().Format("2006-01-02")
				}
				// Try TUF again soon rather than in a day.
				t.root, t.from, t.next = r, from, now.Add(10*time.Minute)
				return r, from, nil
			}
		}
	}
	return nil, "", fmt.Errorf("couldn't load Sigstore's trusted root through TUF (%s): %w", t.remote(), err)
}

// fetch runs a TUF update and returns the verified trusted_root.json.
func (t *TrustRoots) fetch() ([]byte, error) {
	root := t.InitialRoot
	if root == nil {
		root = sigstoreTUFRoot
	}
	cfg, err := config.New(t.remote(), root)
	if err != nil {
		return nil, err
	}
	if t.Dir == "" {
		cfg.DisableLocalCache = true
	} else {
		cfg.LocalMetadataDir = filepath.Join(t.Dir, "tuf")
		cfg.LocalTargetsDir = filepath.Join(t.Dir, "tuf", "targets")
		if err := os.MkdirAll(cfg.LocalTargetsDir, 0o700); err != nil {
			return nil, err
		}
	}
	cfg.PrefixTargetsWithHash = true
	client := t.Client
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	if err := cfg.SetDefaultFetcherHTTPClient(client); err != nil {
		return nil, err
	}
	if err := cfg.SetDefaultFetcherRetry(200*time.Millisecond, 1); err != nil {
		return nil, err
	}
	up, err := updater.New(cfg)
	if err != nil {
		return nil, err
	}
	if err := up.Refresh(); err != nil {
		return nil, err
	}
	ti, err := up.GetTargetInfo("trusted_root.json")
	if err != nil {
		return nil, err
	}
	if !cfg.DisableLocalCache {
		if path, b, err := up.FindCachedTarget(ti, ""); err == nil && path != "" {
			return b, nil
		}
	}
	_, b, err := up.DownloadTarget(ti, "", "")
	return b, err
}
