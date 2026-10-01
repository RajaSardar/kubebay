// Package sigcheck answers, read-only, whether a running image digest has a
// signature published next to it in its registry (Intelligence roadmap
// Tier 2 #17). It looks for a cosign signature tag (sha256-<hex>.sig) and
// for sigstore/cosign artifacts in the OCI 1.1 referrers API. It does not
// verify signatures: that needs the signer's key or Fulcio identity, which
// is the admission controller's job (#32). Registries are contacted
// anonymously; private registries come back "unknown".
package sigcheck

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Status string

const (
	StatusSigned   Status = "signed"
	StatusUnsigned Status = "unsigned"
	StatusUnknown  Status = "unknown"
)

type Ref struct {
	Registry string `json:"registry"`
	Repo     string `json:"repo"`
	Digest   string `json:"digest"`
}

type Result struct {
	Status Status `json:"status"`
	// Method is how a signature was found: "cosign tag" or "OCI referrer".
	Method string `json:"method,omitempty"`
	Reason string `json:"reason,omitempty"`
}

const dockerHub = "registry-1.docker.io"

// ParseRef combines a container's image (spec) and imageID (status) into a
// registry/repo/digest. The digest must be a repo digest; a bare image ID
// ("sha256:…" with no repository) can't be looked up in a registry.
func ParseRef(image, imageID string) (Ref, bool) {
	id := strings.TrimPrefix(imageID, "docker-pullable://")
	name, dig := "", ""
	if i := strings.Index(id, "@sha256:"); i > 0 {
		name, dig = id[:i], id[i+1:]
	} else if i := strings.Index(image, "@sha256:"); i > 0 {
		name, dig = image[:i], image[i+1:]
	} else {
		return Ref{}, false
	}
	// Drop a tag from the name ("repo:tag"), but not a registry port.
	if slash := strings.LastIndex(name, "/"); strings.LastIndex(name, ":") > slash {
		name = name[:strings.LastIndex(name, ":")]
	}
	registry, repo := dockerHub, name
	if i := strings.Index(name, "/"); i > 0 {
		first := name[:i]
		if strings.ContainsAny(first, ".:") || first == "localhost" {
			registry, repo = first, name[i+1:]
		}
	}
	if registry == "docker.io" || registry == "index.docker.io" {
		registry = dockerHub
	}
	if registry == dockerHub && !strings.Contains(repo, "/") {
		repo = "library/" + repo
	}
	return Ref{Registry: registry, Repo: repo, Digest: dig}, true
}

type cached struct {
	res Result
	at  time.Time
}

// Checker caches results per repo@digest for TTL. The zero value is usable.
type Checker struct {
	Client *http.Client
	// Scheme is "https" unless a test serves plain HTTP.
	Scheme string
	TTL    time.Duration

	mu    sync.Mutex
	cache map[string]cached
}

func (c *Checker) client() *http.Client {
	if c.Client != nil {
		return c.Client
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func (c *Checker) Check(ctx context.Context, ref Ref) Result {
	key := ref.Registry + "/" + ref.Repo + "@" + ref.Digest
	ttl := c.TTL
	if ttl == 0 {
		ttl = time.Hour
	}
	c.mu.Lock()
	if e, ok := c.cache[key]; ok && time.Since(e.at) < ttl {
		c.mu.Unlock()
		return e.res
	}
	c.mu.Unlock()

	res := c.check(ctx, ref)
	if res.Status != StatusUnknown {
		c.mu.Lock()
		if c.cache == nil {
			c.cache = map[string]cached{}
		}
		c.cache[key] = cached{res: res, at: time.Now()}
		c.mu.Unlock()
	}
	return res
}

type session struct {
	c     *Checker
	base  string
	token string
}

var errCredentials = fmt.Errorf("registry requires credentials; Kubebay only checks anonymously")

// get performs one request, doing the anonymous bearer-token exchange once on 401.
func (s *session) get(ctx context.Context, path, accept string) (int, []byte, error) {
	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.base+path, nil)
		if err != nil {
			return 0, nil, err
		}
		req.Header.Set("Accept", accept)
		if s.token != "" {
			req.Header.Set("Authorization", "Bearer "+s.token)
		}
		resp, err := s.c.client().Do(req)
		if err != nil {
			return 0, nil, err
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusUnauthorized && attempt == 0 && s.token == "" {
			tok, err := s.c.anonToken(ctx, resp.Header.Get("WWW-Authenticate"))
			if err != nil {
				return 0, nil, err
			}
			s.token = tok
			continue
		}
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return 0, nil, errCredentials
		}
		return resp.StatusCode, body, nil
	}
	return 0, nil, errCredentials
}

func (c *Checker) anonToken(ctx context.Context, challenge string) (string, error) {
	if !strings.HasPrefix(strings.ToLower(challenge), "bearer ") {
		return "", errCredentials
	}
	params := map[string]string{}
	for _, part := range strings.Split(challenge[len("bearer "):], ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok {
			params[strings.ToLower(k)] = strings.Trim(v, `"`)
		}
	}
	if params["realm"] == "" {
		return "", errCredentials
	}
	q := url.Values{}
	if v := params["service"]; v != "" {
		q.Set("service", v)
	}
	if v := params["scope"]; v != "" {
		q.Set("scope", v)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, params["realm"]+"?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errCredentials
	}
	var body struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return "", err
	}
	if body.Token != "" {
		return body.Token, nil
	}
	if body.AccessToken != "" {
		return body.AccessToken, nil
	}
	return "", errCredentials
}

const manifestAccept = "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json"

func (c *Checker) check(ctx context.Context, ref Ref) Result {
	scheme := c.Scheme
	if scheme == "" {
		scheme = "https"
	}
	s := &session{c: c, base: scheme + "://" + ref.Registry + "/v2/" + ref.Repo}
	hex := strings.TrimPrefix(ref.Digest, "sha256:")

	code, _, err := s.get(ctx, "/manifests/sha256-"+hex+".sig", manifestAccept)
	if err != nil {
		return Result{Status: StatusUnknown, Reason: err.Error()}
	}
	if code == http.StatusOK {
		return Result{Status: StatusSigned, Method: "cosign tag"}
	}

	code, body, err := s.get(ctx, "/referrers/"+ref.Digest, "application/vnd.oci.image.index.v1+json")
	if err != nil {
		return Result{Status: StatusUnknown, Reason: err.Error()}
	}
	if code == http.StatusOK {
		var idx struct {
			Manifests []struct {
				ArtifactType string `json:"artifactType"`
			} `json:"manifests"`
		}
		if json.Unmarshal(body, &idx) == nil {
			for _, m := range idx.Manifests {
				a := strings.ToLower(m.ArtifactType)
				if strings.Contains(a, "sigstore") || strings.Contains(a, "cosign") || strings.Contains(a, "signature") {
					return Result{Status: StatusSigned, Method: "OCI referrer"}
				}
			}
		}
	}
	return Result{Status: StatusUnsigned, Reason: "no cosign signature tag or signature referrer for this digest"}
}
