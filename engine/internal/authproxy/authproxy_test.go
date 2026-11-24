package authproxy

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func cidrs(t *testing.T, s string) []netip.Prefix {
	t.Helper()
	p, err := ParseCIDRs(s)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func baseConfig(t *testing.T) Config {
	return Config{UserHeader: "X-Auth-Request-Email", GroupsHeader: "X-Auth-Request-Groups", TrustedCIDRs: cidrs(t, "10.1.2.0/24")}
}

func req(peer string, h map[string]string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/clusters", nil)
	r.RemoteAddr = peer
	for k, v := range h {
		r.Header.Set(k, v)
	}
	return r
}

func newV(t *testing.T, c Config) *Verifier {
	t.Helper()
	v, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestParseCIDRs(t *testing.T) {
	if p, err := ParseCIDRs(" 10.0.0.0/8 , fd00::/8 "); err != nil || len(p) != 2 {
		t.Fatalf("got %v %v", p, err)
	}
	if p, err := ParseCIDRs(""); err != nil || len(p) != 0 {
		t.Fatalf("empty: %v %v", p, err)
	}
	for _, bad := range []string{"garbage", "10.0.0.1", "10.0.0.0/33", "10.0.0.0/8,,"} {
		if _, err := ParseCIDRs(bad); err == nil {
			t.Errorf("%q parsed", bad)
		}
	}
}

func TestValidateRefusals(t *testing.T) {
	ok := baseConfig(t)
	if err := ok.Validate(false); err != nil {
		t.Fatalf("valid config refused: %v", err)
	}
	if err := ok.Validate(true); err == nil {
		t.Error("proxy plus OIDC must be refused")
	}
	cases := map[string]func(*Config){
		"empty cidrs":          func(c *Config) { c.TrustedCIDRs = nil },
		"0.0.0.0/0":            func(c *Config) { c.TrustedCIDRs = cidrs(t, "0.0.0.0/0") },
		"::/0":                 func(c *Config) { c.TrustedCIDRs = cidrs(t, "::/0") },
		"wide cidr no secret":  func(c *Config) { c.TrustedCIDRs = cidrs(t, "10.0.0.0/16") },
		"wide v6 no secret":    func(c *Config) { c.TrustedCIDRs = cidrs(t, "fd00::/48") },
		"no user header":       func(c *Config) { c.UserHeader = "" },
		"bad header name":      func(c *Config) { c.UserHeader = "X Bad\r\n" },
		"secret hdr no secret": func(c *Config) { c.SecretHeader = "X-Proxy-Secret" },
		"secret no hdr":        func(c *Config) { c.Secret = "s3cret" },
	}
	for name, mut := range cases {
		c := baseConfig(t)
		mut(&c)
		if err := c.Validate(false); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestAllowAnyPeerLiftsOnlyTheWideRangeRefusal(t *testing.T) {
	c := baseConfig(t)
	c.TrustedCIDRs = cidrs(t, "0.0.0.0/0")
	c.AllowAnyPeer = true
	if err := c.Validate(false); err != nil {
		t.Errorf("explicit allow refused: %v", err)
	}
	c.TrustedCIDRs = nil
	if err := c.Validate(false); err != nil {
		t.Errorf("explicit allow with empty list refused: %v", err)
	}
	c.UserHeader = ""
	if err := c.Validate(false); err == nil {
		t.Error("allow-any-peer must not lift the user header requirement")
	}
	c = baseConfig(t)
	c.AllowAnyPeer = true
	if err := c.Validate(true); err == nil {
		t.Error("allow-any-peer must not lift the OIDC conflict")
	}
}

func TestWideCIDRWithASecretIsAccepted(t *testing.T) {
	c := baseConfig(t)
	c.TrustedCIDRs = cidrs(t, "10.0.0.0/16")
	c.SecretHeader, c.Secret = "X-Proxy-Secret", "s3cret"
	if err := c.Validate(false); err != nil {
		t.Fatal(err)
	}
}

func TestTrustedPeer(t *testing.T) {
	v := newV(t, baseConfig(t))
	id, err := v.Identify(req("10.1.2.7:5555", map[string]string{"X-Auth-Request-Email": "alice@example.com", "X-Auth-Request-Groups": "dev, ops ,dev"}))
	if err != nil {
		t.Fatal(err)
	}
	if id.Name != "alice@example.com" || strings.Join(id.Groups, "|") != "dev|ops" {
		t.Fatalf("identity %+v", id)
	}
}

func TestUntrustedPeerIsRefusedWhateverTheHeadersSay(t *testing.T) {
	v := newV(t, baseConfig(t))
	h := map[string]string{
		"X-Auth-Request-Email": "admin@example.com",
		"X-Forwarded-For":      "10.1.2.7",
		"X-Real-IP":            "10.1.2.7",
		"Forwarded":            "for=10.1.2.7",
	}
	for _, peer := range []string{"192.0.2.1:1234", "11.1.2.7:1", "[2001:db8::1]:80", "", "garbage", "unix"} {
		if id, err := v.Identify(req(peer, h)); err == nil || id != nil {
			t.Errorf("peer %q accepted", peer)
		}
	}
}

func TestIPv4MappedIPv6PeerMatches(t *testing.T) {
	v := newV(t, baseConfig(t))
	if _, err := v.Identify(req("[::ffff:10.1.2.9]:80", map[string]string{"X-Auth-Request-Email": "a"})); err != nil {
		t.Fatal(err)
	}
}

func TestMissingOrEmptyUserHeader(t *testing.T) {
	v := newV(t, baseConfig(t))
	for _, h := range []map[string]string{nil, {"X-Auth-Request-Email": ""}, {"X-Auth-Request-Email": "   "}} {
		if _, err := v.Identify(req("10.1.2.7:1", h)); err == nil {
			t.Errorf("accepted %v", h)
		}
	}
}

func TestMalformedValuesAreRefusedWholesale(t *testing.T) {
	v := newV(t, baseConfig(t))
	long := strings.Repeat("a", 257)
	manyGroups := strings.TrimSuffix(strings.Repeat("g,", 65), ",")
	bigGroups := strings.Repeat("g", 200) + strings.Repeat(","+strings.Repeat("h", 200), 45)
	cases := []struct{ name, user, groups string }{
		{"CR", "alice\rx", ""},
		{"LF", "alice\nx", ""},
		{"NUL", "al\x00ice", ""},
		{"tab inside", "al\tice", ""},
		{"DEL", "al\x7fice", ""},
		{"invalid utf8", "al\xffice", ""},
		{"oversized user", long, ""},
		{"group control", "alice", "dev,o\x01ps"},
		{"group oversized", "alice", "dev," + long},
		{"too many groups", "alice", manyGroups},
		{"groups header over 8KiB", "alice", bigGroups},
		{"empty group element", "alice", "dev,,ops"},
	}
	for _, c := range cases {
		r := req("10.1.2.7:1", nil)
		r.Header["X-Auth-Request-Email"] = []string{c.user}
		if c.groups != "" {
			r.Header["X-Auth-Request-Groups"] = []string{c.groups}
		}
		if id, err := v.Identify(r); err == nil || id != nil {
			t.Errorf("%s accepted: %+v", c.name, id)
		}
	}
	// Exactly at the limits is fine.
	r := req("10.1.2.7:1", map[string]string{"X-Auth-Request-Email": strings.Repeat("a", 256), "X-Auth-Request-Groups": strings.TrimSuffix(strings.Repeat("g,", 64), ",")})
	if _, err := v.Identify(r); err != nil {
		t.Errorf("at the limits: %v", err)
	}
}

func TestDuplicateUserHeadersAreRefused(t *testing.T) {
	v := newV(t, baseConfig(t))
	r := req("10.1.2.7:1", nil)
	r.Header.Add("X-Auth-Request-Email", "alice")
	r.Header.Add("X-Auth-Request-Email", "admin")
	if _, err := v.Identify(r); err == nil {
		t.Error("two user headers accepted")
	}
}

func TestSystemIdentitiesRefusedByDefault(t *testing.T) {
	v := newV(t, baseConfig(t))
	for _, h := range []map[string]string{
		{"X-Auth-Request-Email": "system:admin"},
		{"X-Auth-Request-Email": "alice", "X-Auth-Request-Groups": "dev,system:masters"},
	} {
		if _, err := v.Identify(req("10.1.2.7:1", h)); err == nil {
			t.Errorf("accepted %v", h)
		}
	}
	c := baseConfig(t)
	c.AllowSystemIdentities = true
	v = newV(t, c)
	if _, err := v.Identify(req("10.1.2.7:1", map[string]string{"X-Auth-Request-Email": "system:admin"})); err != nil {
		t.Errorf("opt-in refused: %v", err)
	}
}

func TestSharedSecret(t *testing.T) {
	c := baseConfig(t)
	c.SecretHeader, c.Secret = "X-Proxy-Secret", "s3cret"
	v := newV(t, c)
	ok := map[string]string{"X-Auth-Request-Email": "alice", "X-Proxy-Secret": "s3cret"}
	if _, err := v.Identify(req("10.1.2.7:1", ok)); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"", "wrong", "s3cret2", "S3CRET"} {
		h := map[string]string{"X-Auth-Request-Email": "alice"}
		if secret != "" {
			h["X-Proxy-Secret"] = secret
		}
		if _, err := v.Identify(req("10.1.2.7:1", h)); err == nil {
			t.Errorf("secret %q accepted", secret)
		}
	}
}

func TestScrubRemovesIdentityAndImpersonationHeaders(t *testing.T) {
	c := baseConfig(t)
	c.SecretHeader, c.Secret = "X-Proxy-Secret", "s3cret"
	v := newV(t, c)
	r := req("10.1.2.7:1", map[string]string{
		"X-Auth-Request-Email": "a", "X-Auth-Request-Groups": "g", "X-Proxy-Secret": "s3cret",
		"Impersonate-User": "root", "Impersonate-Group": "system:masters", "Impersonate-Extra-Scopes": "x", "X-Other": "keep",
	})
	v.Scrub(r.Header)
	for _, k := range []string{"X-Auth-Request-Email", "X-Auth-Request-Groups", "X-Proxy-Secret", "Impersonate-User", "Impersonate-Group", "Impersonate-Extra-Scopes"} {
		if r.Header.Get(k) != "" {
			t.Errorf("%s survived", k)
		}
	}
	if r.Header.Get("X-Other") != "keep" {
		t.Error("unrelated header dropped")
	}
}

func TestNilVerifierIsDisabled(t *testing.T) {
	var v *Verifier
	if v.Enabled() {
		t.Error("nil verifier enabled")
	}
}

func TestBuild(t *testing.T) {
	// Nothing set: mode off, no error.
	if v, err := Build(Options{}, ""); v != nil || err != nil {
		t.Fatalf("off: %v %v", v, err)
	}
	// Dead config without a user header is an error, not silently off.
	if _, err := Build(Options{GroupsHeader: "X-G"}, ""); err == nil {
		t.Error("groups header alone accepted")
	}
	if _, err := Build(Options{TrustedCIDRs: "10.0.0.0/24"}, ""); err == nil {
		t.Error("cidrs alone accepted")
	}
	// OIDC conflict.
	if _, err := Build(Options{UserHeader: "X-U", TrustedCIDRs: "10.0.0.0/24"}, "https://issuer"); err == nil {
		t.Error("proxy and OIDC accepted")
	}
	// Missing CIDRs.
	if _, err := Build(Options{UserHeader: "X-U"}, ""); err == nil {
		t.Error("no CIDRs accepted")
	}
	// Secret from file, trimmed.
	dir := t.TempDir()
	f := filepath.Join(dir, "secret")
	if err := os.WriteFile(f, []byte("s3cret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	v, err := Build(Options{UserHeader: "X-U", TrustedCIDRs: "10.0.0.0/16", SecretHeader: "X-S", SecretFile: f}, "")
	if err != nil || !v.Enabled() {
		t.Fatalf("file secret: %v", err)
	}
	if _, err := v.Identify(req("10.0.5.5:1", map[string]string{"X-U": "a", "X-S": "s3cret"})); err != nil {
		t.Errorf("file secret not applied: %v", err)
	}
	// Secret from env value.
	v, err = Build(Options{UserHeader: "X-U", TrustedCIDRs: "10.0.0.0/16", SecretHeader: "X-S", Secret: "envsecret"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Identify(req("10.0.5.5:1", map[string]string{"X-U": "a", "X-S": "envsecret"})); err != nil {
		t.Error(err)
	}
	// Unreadable or empty secret file.
	if _, err := Build(Options{UserHeader: "X-U", TrustedCIDRs: "10.0.0.0/24", SecretHeader: "X-S", SecretFile: filepath.Join(dir, "nope")}, ""); err == nil {
		t.Error("missing secret file accepted")
	}
	empty := filepath.Join(dir, "empty")
	_ = os.WriteFile(empty, []byte("\n"), 0o600)
	if _, err := Build(Options{UserHeader: "X-U", TrustedCIDRs: "10.0.0.0/24", SecretHeader: "X-S", SecretFile: empty}, ""); err == nil {
		t.Error("empty secret file accepted")
	}
}
