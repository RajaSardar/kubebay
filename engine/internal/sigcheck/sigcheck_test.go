package sigcheck

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

const digest = "sha256:" + "ab0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"

func TestParseRef(t *testing.T) {
	cases := []struct {
		image, imageID      string
		registry, repo, dig string
		ok                  bool
	}{
		{"nginx:1.27", "docker-pullable://nginx@" + digest, "registry-1.docker.io", "library/nginx", digest, true},
		{"docker.io/bitnami/redis:7", "docker.io/bitnami/redis@" + digest, "registry-1.docker.io", "bitnami/redis", digest, true},
		{"ghcr.io/org/app:1.2", "ghcr.io/org/app@" + digest, "ghcr.io", "org/app", digest, true},
		{"localhost:5000/team/svc@" + digest, "sha256:deadbeef", "localhost:5000", "team/svc", digest, true},
		{"quay.io/x/y:latest", "sha256:deadbeef", "", "", "", false}, // runtime gave only an image ID, no repo digest
	}
	for _, c := range cases {
		r, ok := ParseRef(c.image, c.imageID)
		if ok != c.ok {
			t.Errorf("%s: ok = %v, want %v", c.image, ok, c.ok)
			continue
		}
		if ok && (r.Registry != c.registry || r.Repo != c.repo || r.Digest != c.dig) {
			t.Errorf("%s: got %+v, want %s %s %s", c.image, r, c.registry, c.repo, c.dig)
		}
	}
}

// fakeRegistry serves a token endpoint and manifests; anonymous tokens only.
func fakeRegistry(t *testing.T, signedTag bool, referrers []string, requireToken bool) (*httptest.Server, *int32) {
	t.Helper()
	var hits int32
	mux := http.NewServeMux()
	var srv *httptest.Server
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("scope") != "repository:org/app:pull" {
			t.Errorf("token scope = %q", r.URL.Query().Get("scope"))
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "anon"})
	})
	mux.HandleFunc("/v2/", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if requireToken && r.Header.Get("Authorization") != "Bearer anon" {
			w.Header().Set("WWW-Authenticate", `Bearer realm="`+srv.URL+`/token",service="reg",scope="repository:org/app:pull"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/manifests/sha256-"+strings.TrimPrefix(digest, "sha256:")+".sig"):
			if signedTag {
				w.WriteHeader(http.StatusOK)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		case strings.HasSuffix(r.URL.Path, "/referrers/"+digest):
			if referrers == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			var ms []map[string]string
			for _, a := range referrers {
				ms = append(ms, map[string]string{"artifactType": a})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"manifests": ms})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, &hits
}

func refFor(srv *httptest.Server) Ref {
	return Ref{Registry: strings.TrimPrefix(srv.URL, "http://"), Repo: "org/app", Digest: digest}
}

func TestCheckFindsCosignTagSignature(t *testing.T) {
	srv, _ := fakeRegistry(t, true, nil, false)
	c := &Checker{Scheme: "http"}
	got := c.Check(context.Background(), refFor(srv))
	if got.Status != StatusSigned || got.Method != "cosign tag" {
		t.Fatalf("got %+v, want signed via cosign tag", got)
	}
}

func TestCheckFindsSigstoreReferrer(t *testing.T) {
	srv, _ := fakeRegistry(t, false, []string{"application/vnd.dev.sigstore.bundle.v0.3+json"}, false)
	got := (&Checker{Scheme: "http"}).Check(context.Background(), refFor(srv))
	if got.Status != StatusSigned || got.Method != "OCI referrer" {
		t.Fatalf("got %+v, want signed via OCI referrer", got)
	}
}

func TestCheckIgnoresNonSignatureReferrers(t *testing.T) {
	srv, _ := fakeRegistry(t, false, []string{"application/spdx+json"}, false)
	got := (&Checker{Scheme: "http"}).Check(context.Background(), refFor(srv))
	if got.Status != StatusUnsigned {
		t.Fatalf("got %+v, want unsigned (an SBOM referrer is not a signature)", got)
	}
}

func TestCheckUnsignedWhenNothingFound(t *testing.T) {
	srv, _ := fakeRegistry(t, false, nil, false)
	got := (&Checker{Scheme: "http"}).Check(context.Background(), refFor(srv))
	if got.Status != StatusUnsigned || got.Reason == "" {
		t.Fatalf("got %+v, want unsigned with a reason", got)
	}
}

func TestCheckUsesAnonymousBearerToken(t *testing.T) {
	srv, _ := fakeRegistry(t, true, nil, true)
	got := (&Checker{Scheme: "http"}).Check(context.Background(), refFor(srv))
	if got.Status != StatusSigned {
		t.Fatalf("got %+v, want signed after the anonymous token dance", got)
	}
}

func TestCheckUnknownWhenRegistryNeedsCredentials(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("WWW-Authenticate", `Basic realm="private"`)
		w.WriteHeader(http.StatusUnauthorized)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	got := (&Checker{Scheme: "http"}).Check(context.Background(), refFor(srv))
	if got.Status != StatusUnknown || !strings.Contains(got.Reason, "credentials") {
		t.Fatalf("got %+v, want unknown because the registry needs credentials", got)
	}
}

func TestCheckUnknownWhenUnreachable(t *testing.T) {
	got := (&Checker{Scheme: "http"}).Check(context.Background(), Ref{Registry: "127.0.0.1:1", Repo: "org/app", Digest: digest})
	if got.Status != StatusUnknown {
		t.Fatalf("got %+v, want unknown", got)
	}
}

func TestCheckCachesByDigest(t *testing.T) {
	srv, hits := fakeRegistry(t, true, nil, false)
	c := &Checker{Scheme: "http"}
	c.Check(context.Background(), refFor(srv))
	before := atomic.LoadInt32(hits)
	c.Check(context.Background(), refFor(srv))
	if atomic.LoadInt32(hits) != before {
		t.Error("second check of the same digest hit the registry again")
	}
}
