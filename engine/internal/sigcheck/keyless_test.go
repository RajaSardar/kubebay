package sigcheck

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// The fixtures are real: Sigstore's public trusted root, and the signature
// manifest cosign's own release published for ghcr.io/sigstore/cosign/cosign
// v2.6.0 (layer 1 is keyless; layer 0 is signed with a key).
func realRoot(t *testing.T) *TrustedRoot {
	t.Helper()
	b, err := os.ReadFile("testdata/trusted_root.json")
	if err != nil {
		t.Fatal(err)
	}
	r, err := ParseTrustedRoot(b)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

type realLayer struct {
	ann    map[string]string
	sig    []byte
	digest []byte
}

func realLayers(t *testing.T) []realLayer {
	t.Helper()
	b, err := os.ReadFile("testdata/cosign-v2.6.0.sig.json")
	if err != nil {
		t.Fatal(err)
	}
	var m sigManifest
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	var out []realLayer
	for _, l := range m.Layers {
		sig, _ := base64.StdEncoding.DecodeString(l.Annotations[annSignature])
		d, _ := hex.DecodeString(strings.TrimPrefix(l.Digest, "sha256:"))
		out = append(out, realLayer{ann: l.Annotations, sig: sig, digest: d})
	}
	return out
}

func copyAnn(a map[string]string) map[string]string {
	c := map[string]string{}
	for k, v := range a {
		c[k] = v
	}
	return c
}

func TestParseTrustedRootReadsSigstoresPublicRoot(t *testing.T) {
	r := realRoot(t)
	if len(r.CAs) != 2 || len(r.Tlogs) != 2 || len(r.CTLogs) != 2 {
		t.Fatalf("root = %d CAs, %d tlogs, %d ctlogs", len(r.CAs), len(r.Tlogs), len(r.CTLogs))
	}
	if r.CAs[0].End.IsZero() || !r.CAs[1].End.IsZero() || len(r.CAs[1].Certs) != 2 || !r.CAs[1].Certs[1].IsCA {
		t.Errorf("CAs = %+v", r.CAs)
	}
	// A log's ID is the SHA-256 of its public key.
	for _, l := range append(r.Tlogs, r.CTLogs...) {
		if len(l.ID) != sha256.Size || l.Key == nil || l.Start.IsZero() {
			t.Errorf("log %s = %+v", l.URL, l)
		}
	}
	if hex.EncodeToString(r.Tlogs[0].ID)[:16] != "c0d23d6ad406973f" {
		t.Errorf("rekor log id = %x", r.Tlogs[0].ID)
	}
	if _, err := ParseTrustedRoot([]byte(`{"mediaType":"application/vnd.something-else"}`)); err == nil {
		t.Error("a document that isn't a trusted root is rejected")
	}
}

func TestKeylessVerifiesARealCosignSignature(t *testing.T) {
	l := realLayers(t)[1]
	s, err := verifyKeyless(realRoot(t), l.ann, l.sig, l.digest, nil)
	if err != nil {
		t.Fatal(err)
	}
	if s.Subject != "keyless@projectsigstore.iam.gserviceaccount.com" || s.Issuer != "https://accounts.google.com" {
		t.Errorf("signer = %+v", s)
	}
	if s.LoggedAt.UTC().Format(time.RFC3339) != "2025-09-12T20:47:52Z" {
		t.Errorf("logged at %v", s.LoggedAt)
	}
}

func TestKeylessRejectsTampering(t *testing.T) {
	root := realRoot(t)
	l := realLayers(t)[1]
	bundle := l.ann[annBundle]

	wrongDigest := append([]byte{}, l.digest...)
	wrongDigest[0] ^= 1
	key := realLayers(t)[0]
	cases := map[string]struct {
		ann    map[string]string
		sig    []byte
		digest []byte
		want   string
	}{
		"another payload":   {l.ann, l.sig, wrongDigest, "transparency log entry"},
		"another signature": {l.ann, key.sig, l.digest, "transparency log entry"},
		"no log entry":      {func() map[string]string { a := copyAnn(l.ann); delete(a, annBundle); return a }(), l.sig, l.digest, "no transparency log entry"},
		"a forged log time": {func() map[string]string {
			a := copyAnn(l.ann)
			a[annBundle] = strings.Replace(bundle, `"integratedTime":1757710072`, `"integratedTime":1757710073`, 1)
			return a
		}(), l.sig, l.digest, "transparency log"},
		"a certificate it never saw": {func() map[string]string { a := copyAnn(l.ann); a[annCertificate] = testLeafPEM(t); return a }(), l.sig, l.digest, ""},
	}
	for name, tc := range cases {
		_, err := verifyKeyless(root, tc.ann, tc.sig, tc.digest, nil)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want %q", name, err, tc.want)
		}
	}
}

// Trust comes from the trusted root only: drop Fulcio, the CT logs or
// Rekor from it and the same signature no longer verifies.
func TestKeylessTrustsOnlyTheTrustedRoot(t *testing.T) {
	l := realLayers(t)[1]
	for name, cut := range map[string]func(*TrustedRoot){
		"Fulcio":  func(r *TrustedRoot) { r.CAs = nil },
		"SCT":     func(r *TrustedRoot) { r.CTLogs = nil },
		"Rekor":   func(r *TrustedRoot) { r.Tlogs = nil },
		"expired": func(r *TrustedRoot) { r.CAs = r.CAs[:1] },
	} {
		r := realRoot(t)
		cut(r)
		want := name
		if name == "expired" {
			want = "Fulcio"
		}
		if _, err := verifyKeyless(r, l.ann, l.sig, l.digest, nil); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("without %s: err = %v", name, err)
		}
	}
}

func TestKeylessIdentityMatching(t *testing.T) {
	s := Signer{Subject: "https://github.com/acme/app/.github/workflows/release.yml@refs/tags/v1.2.0", Issuer: "https://token.actions.githubusercontent.com"}
	for _, tc := range []struct {
		id   KeylessIdentity
		want bool
	}{
		{KeylessIdentity{Subject: s.Subject, Issuer: s.Issuer}, true},
		{KeylessIdentity{Subject: s.Subject, Issuer: "https://accounts.google.com"}, false},
		{KeylessIdentity{SubjectRegExp: `^https://github\.com/acme/.*`, Issuer: s.Issuer}, true},
		{KeylessIdentity{SubjectRegExp: `^https://github\.com/other/`, Issuer: s.Issuer}, false},
		{KeylessIdentity{Subject: "https://github.com/acme/*", IssuerRegExp: `githubusercontent\.com$`, Wildcards: true}, true},
		{KeylessIdentity{Subject: "https://github.com/acme/*", Issuer: s.Issuer}, false},
		{KeylessIdentity{}, true},
	} {
		if got := tc.id.Matches(s); got != tc.want {
			t.Errorf("%+v matches = %v, want %v", tc.id, got, tc.want)
		}
	}
}
