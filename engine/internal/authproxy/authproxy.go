// Package authproxy lets the in-cluster engine take a user's identity from
// headers set by an authenticating reverse proxy (oauth2-proxy, an ingress
// with auth, a corporate gateway) instead of built-in OIDC.
//
// The trust rule is narrow on purpose: headers are read only when the direct
// TCP peer (r.RemoteAddr) is inside the configured CIDRs. X-Forwarded-For,
// Forwarded and X-Real-IP are never consulted, because a client can set them.
// A request that fails any check is refused; there is no anonymous fallback.
// The identity that comes out is the same clusters.Identity OIDC produces, so
// impersonation, per-user caches and the audit user field work unchanged.
package authproxy

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

const (
	maxValueBytes   = 256
	maxGroups       = 64
	maxGroupsHeader = 8 << 10
	// A trusted range wider than this is a pod network, not a proxy: it needs
	// a shared secret (or an explicit allow-any-peer).
	maxPlainV4Bits = 24
	maxPlainV6Bits = 64
)

// Identify failures. Callers log them with the peer address; they are never
// shown to the client beyond a plain 401.
var (
	ErrUntrustedPeer = errors.New("peer is outside the trusted CIDRs")
	ErrBadSecret     = errors.New("shared secret header missing or wrong")
	ErrBadIdentity   = errors.New("identity headers missing or malformed")
)

// Config is the validated shape of the mode.
type Config struct {
	UserHeader   string
	GroupsHeader string
	SecretHeader string
	Secret       string
	TrustedCIDRs []netip.Prefix
	// AllowAnyPeer acknowledges the risk of an empty, 0.0.0.0/0 or ::/0 trusted
	// range, or a wide one without a shared secret.
	AllowAnyPeer bool
	// AllowSystemIdentities lets the proxy name system: users and the
	// system:masters group. Off by default.
	AllowSystemIdentities bool
}

// ParseCIDRs parses a comma separated CIDR list. Empty input is an empty list.
func ParseCIDRs(s string) ([]netip.Prefix, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	var out []netip.Prefix
	for _, part := range strings.Split(s, ",") {
		p, err := netip.ParsePrefix(strings.TrimSpace(part))
		if err != nil {
			return nil, fmt.Errorf("trusted CIDR %q: %w", part, err)
		}
		out = append(out, p.Masked())
	}
	return out, nil
}

func validHeaderName(n string) bool {
	if n == "" {
		return false
	}
	for i := 0; i < len(n); i++ {
		c := n[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-':
		default:
			return false
		}
	}
	return true
}

// Validate returns the first reason the mode must not start.
func (c Config) Validate(oidcEnabled bool) error {
	if oidcEnabled {
		return errors.New("auth-proxy mode and OIDC are both configured; pick one, the engine will not mix them")
	}
	if !validHeaderName(c.UserHeader) {
		return errors.New("--auth-proxy-user-header is required and must be a plain header name")
	}
	for flagName, h := range map[string]string{"--auth-proxy-groups-header": c.GroupsHeader, "--auth-proxy-secret-header": c.SecretHeader} {
		if h != "" && !validHeaderName(h) {
			return fmt.Errorf("%s %q is not a plain header name", flagName, h)
		}
	}
	if (c.SecretHeader == "") != (c.Secret == "") {
		return errors.New("--auth-proxy-secret-header and the shared secret (file or env) must be set together")
	}
	names := map[string]bool{}
	for _, h := range []string{c.UserHeader, c.GroupsHeader, c.SecretHeader} {
		k := http.CanonicalHeaderKey(h)
		if h != "" && names[k] {
			return fmt.Errorf("header %q is used for more than one purpose", h)
		}
		names[k] = true
	}
	if c.AllowAnyPeer {
		return nil
	}
	if len(c.TrustedCIDRs) == 0 {
		return errors.New("--auth-proxy-trusted-cidrs is required: name the proxy's address range, or pass --auth-proxy-allow-any-peer to trust every peer")
	}
	for _, p := range c.TrustedCIDRs {
		if p.Bits() == 0 {
			return fmt.Errorf("trusted CIDR %s trusts every peer; pass --auth-proxy-allow-any-peer to acknowledge the risk", p)
		}
		wide := (p.Addr().Is4() && p.Bits() < maxPlainV4Bits) || (p.Addr().Is6() && !p.Addr().Is4In6() && p.Bits() < maxPlainV6Bits)
		if wide && c.Secret == "" {
			return fmt.Errorf("trusted CIDR %s is wider than a proxy range; set a shared secret header or pass --auth-proxy-allow-any-peer", p)
		}
	}
	return nil
}

// Verifier decides who a request is from.
type Verifier struct{ c Config }

// New validates c (without the OIDC check, which Build does) and returns a Verifier.
func New(c Config) (*Verifier, error) {
	if err := c.Validate(false); err != nil {
		return nil, err
	}
	return &Verifier{c: c}, nil
}

// Enabled is nil-safe.
func (v *Verifier) Enabled() bool { return v != nil }

func (v *Verifier) trusted(remoteAddr string) bool {
	if len(v.c.TrustedCIDRs) == 0 {
		return v.c.AllowAnyPeer
	}
	ap, err := netip.ParseAddrPort(remoteAddr)
	if err != nil {
		return false
	}
	a := ap.Addr().Unmap()
	for _, p := range v.c.TrustedCIDRs {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// Identify returns the identity a trusted proxy attached to r, or an error.
// It does not modify r.
func (v *Verifier) Identify(r *http.Request) (*clusters.Identity, error) {
	if !v.trusted(r.RemoteAddr) {
		return nil, ErrUntrustedPeer
	}
	if v.c.SecretHeader != "" {
		got := sha256.Sum256([]byte(r.Header.Get(v.c.SecretHeader)))
		want := sha256.Sum256([]byte(v.c.Secret))
		if subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
			return nil, ErrBadSecret
		}
	}
	users := r.Header.Values(v.c.UserHeader)
	if len(users) != 1 {
		return nil, fmt.Errorf("%w: want exactly one %s header, got %d", ErrBadIdentity, v.c.UserHeader, len(users))
	}
	name, err := cleanValue(users[0])
	if err != nil {
		return nil, fmt.Errorf("%w: user: %v", ErrBadIdentity, err)
	}
	if !v.c.AllowSystemIdentities && strings.HasPrefix(name, "system:") {
		return nil, fmt.Errorf("%w: system: users are refused", ErrBadIdentity)
	}
	id := &clusters.Identity{Name: name}
	if v.c.GroupsHeader != "" {
		groups, err := v.parseGroups(r.Header.Values(v.c.GroupsHeader))
		if err != nil {
			return nil, fmt.Errorf("%w: groups: %v", ErrBadIdentity, err)
		}
		id.Groups = groups
	}
	return id, nil
}

func cleanValue(s string) (string, error) {
	s = strings.Trim(s, " ")
	if s == "" {
		return "", errors.New("empty")
	}
	if len(s) > maxValueBytes {
		return "", errors.New("too long")
	}
	if !utf8.ValidString(s) {
		return "", errors.New("not valid UTF-8")
	}
	for i := 0; i < len(s); i++ {
		if s[i] < 0x20 || s[i] == 0x7f {
			return "", errors.New("control character")
		}
	}
	return s, nil
}

func (v *Verifier) parseGroups(values []string) ([]string, error) {
	raw := strings.Join(values, ",")
	if strings.Trim(raw, " ") == "" {
		return nil, nil
	}
	if len(raw) > maxGroupsHeader {
		return nil, errors.New("header too large")
	}
	parts := strings.Split(raw, ",")
	if len(parts) > maxGroups {
		return nil, errors.New("too many groups")
	}
	seen := map[string]bool{}
	var out []string
	for _, p := range parts {
		g, err := cleanValue(p)
		if err != nil {
			return nil, err
		}
		if !v.c.AllowSystemIdentities && g == "system:masters" {
			return nil, errors.New("system:masters is refused")
		}
		if !seen[g] {
			seen[g] = true
			out = append(out, g)
		}
	}
	return out, nil
}

// Scrub removes the identity, secret and impersonation headers from h so
// nothing downstream can re-read them. Defence in depth: the engine builds
// impersonation from the context, never from request headers.
func (v *Verifier) Scrub(h http.Header) {
	for _, n := range []string{v.c.UserHeader, v.c.GroupsHeader, v.c.SecretHeader} {
		if n != "" {
			h.Del(n)
		}
	}
	for k := range h {
		if strings.HasPrefix(http.CanonicalHeaderKey(k), "Impersonate-") {
			delete(h, k)
		}
	}
}

// Options are the raw flag and env values.
type Options struct {
	UserHeader, GroupsHeader, SecretHeader string
	TrustedCIDRs                           string
	// Secret is the shared secret value (from env); SecretFile wins when set.
	Secret, SecretFile                  string
	AllowAnyPeer, AllowSystemIdentities bool
}

func (o Options) any() bool {
	return o.UserHeader != "" || o.GroupsHeader != "" || o.SecretHeader != "" || o.TrustedCIDRs != "" ||
		o.Secret != "" || o.SecretFile != "" || o.AllowAnyPeer || o.AllowSystemIdentities
}

// Build turns flags into a Verifier. It returns (nil, nil) when no auth-proxy
// option is set, and an error for dead or unsafe configuration, including the
// OIDC conflict, so main can refuse to start.
func Build(o Options, oidcIssuer string) (*Verifier, error) {
	if !o.any() {
		return nil, nil
	}
	secret := o.Secret
	if o.SecretFile != "" {
		b, err := os.ReadFile(o.SecretFile)
		if err != nil {
			return nil, fmt.Errorf("auth-proxy secret file: %w", err)
		}
		secret = strings.TrimRight(string(b), "\r\n")
		if secret == "" {
			return nil, errors.New("auth-proxy secret file is empty")
		}
	}
	cidrs, err := ParseCIDRs(o.TrustedCIDRs)
	if err != nil {
		return nil, err
	}
	c := Config{
		UserHeader: o.UserHeader, GroupsHeader: o.GroupsHeader, SecretHeader: o.SecretHeader,
		Secret: secret, TrustedCIDRs: cidrs, AllowAnyPeer: o.AllowAnyPeer, AllowSystemIdentities: o.AllowSystemIdentities,
	}
	if err := c.Validate(oidcIssuer != ""); err != nil {
		return nil, err
	}
	return &Verifier{c: c}, nil
}
