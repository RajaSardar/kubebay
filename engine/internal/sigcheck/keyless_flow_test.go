package sigcheck

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func keylessRegistry(t *testing.T, ts *testSigstore, payload []byte, email, issuer string) Ref {
	t.Helper()
	ann, sig := ts.sign(t, payload, email, issuer, time.Now().Add(-time.Hour))
	reg := &sigRegistry{payload: payload, sig: sig, ann: ann}
	return sigRef(reg.serve(t))
}

func rootsFrom(r *TrustedRoot) func(context.Context) (*TrustedRoot, string, error) {
	return func(context.Context) (*TrustedRoot, string, error) { return r, "test", nil }
}

func TestKeylessSignatureVerifiedAgainstAPolicyIdentity(t *testing.T) {
	ts := newTestSigstore(t)
	ref := keylessRegistry(t, ts, payloadFor(digest), "release@acme.dev", "https://accounts.google.com")
	c := &Checker{Scheme: "http"}
	res := c.CheckWith(context.Background(), ref, Options{Roots: rootsFrom(ts.root), Identities: []KeylessIdentity{
		{Source: "Kyverno ClusterPolicy other", Subject: "someone@else.dev", Issuer: "https://accounts.google.com"},
		{Source: "Kyverno ClusterPolicy verify-acme", Subject: "release@acme.dev", Issuer: "https://accounts.google.com"},
	}})
	if res.Status != StatusSigned || res.Verification != VerifiedOK || res.VerifiedBy != "Kyverno ClusterPolicy verify-acme" ||
		res.Signer != "release@acme.dev" || res.Issuer != "https://accounts.google.com" {
		t.Errorf("got %+v", res)
	}
}

func TestKeylessSignatureBySomeoneElseFails(t *testing.T) {
	ts := newTestSigstore(t)
	ref := keylessRegistry(t, ts, payloadFor(digest), "mallory@evil.dev", "https://accounts.google.com")
	c := &Checker{Scheme: "http"}
	res := c.CheckWith(context.Background(), ref, Options{Roots: rootsFrom(ts.root), Identities: []KeylessIdentity{{Source: "p", Subject: "release@acme.dev", Issuer: "https://accounts.google.com"}}})
	if res.Verification != VerifiedFailed || res.Signer != "mallory@evil.dev" || !strings.Contains(res.Reason, "mallory@evil.dev") || !strings.Contains(res.Reason, "no policy identity") {
		t.Errorf("got %+v", res)
	}
}

// With no policy identity, the signature is still checked against Sigstore's
// roots, and the signer is named: who signed is the useful answer.
func TestKeylessSignerIsNamedWithoutAPolicy(t *testing.T) {
	ts := newTestSigstore(t)
	ref := keylessRegistry(t, ts, payloadFor(digest), "release@acme.dev", "https://accounts.google.com")
	res := (&Checker{Scheme: "http"}).CheckWith(context.Background(), ref, Options{Roots: rootsFrom(ts.root)})
	if res.Verification != VerifiedKeyless || res.Signer != "release@acme.dev" || res.Issuer != "https://accounts.google.com" || !strings.Contains(res.Reason, "no policy") {
		t.Errorf("got %+v", res)
	}
}

func TestKeylessSignatureForAnotherImageFails(t *testing.T) {
	ts := newTestSigstore(t)
	ref := keylessRegistry(t, ts, payloadFor("sha256:"+strings.Repeat("b", 64)), "release@acme.dev", "https://accounts.google.com")
	res := (&Checker{Scheme: "http"}).CheckWith(context.Background(), ref, Options{Roots: rootsFrom(ts.root)})
	if res.Verification != VerifiedFailed || !strings.Contains(res.Reason, "different image digest") {
		t.Errorf("got %+v", res)
	}
}

func TestKeylessFromAnUntrustedFulcioFails(t *testing.T) {
	ts, other := newTestSigstore(t), newTestSigstore(t)
	ref := keylessRegistry(t, ts, payloadFor(digest), "release@acme.dev", "https://accounts.google.com")
	// The same Rekor and CT logs, but another Fulcio.
	root := &TrustedRoot{CAs: other.root.CAs, Tlogs: ts.root.Tlogs, CTLogs: ts.root.CTLogs}
	res := (&Checker{Scheme: "http"}).CheckWith(context.Background(), ref, Options{Roots: rootsFrom(root)})
	if res.Verification != VerifiedFailed || res.Signer != "" || !strings.Contains(res.Reason, "Fulcio") {
		t.Errorf("got %+v", res)
	}
}

// Without trust roots (offline, first run) a keyless signature is reported
// as found and unchecked, saying why, and the result isn't cached.
func TestKeylessWithoutTrustRootsSaysWhy(t *testing.T) {
	ts := newTestSigstore(t)
	ref := keylessRegistry(t, ts, payloadFor(digest), "release@acme.dev", "https://accounts.google.com")
	c := &Checker{Scheme: "http"}
	res := c.CheckWith(context.Background(), ref, Options{Roots: func(context.Context) (*TrustedRoot, string, error) {
		return nil, "", errors.New("tuf-repo-cdn.sigstore.dev unreachable")
	}})
	if res.Verification != VerifiedKeyless || res.Signer != "" || !strings.Contains(res.Reason, "unreachable") {
		t.Errorf("got %+v", res)
	}
	res = c.CheckWith(context.Background(), ref, Options{Roots: rootsFrom(ts.root)})
	if res.Signer != "release@acme.dev" {
		t.Errorf("an unchecked keyless result must not be cached: %+v", res)
	}
}

// An identity Kubebay can't check (the policy names its own Fulcio or
// Rekor) is reported as such, not as a failure.
func TestKeylessIdentityWithItsOwnRootsIsNotJudged(t *testing.T) {
	ts := newTestSigstore(t)
	ref := keylessRegistry(t, ts, payloadFor(digest), "release@acme.dev", "https://accounts.google.com")
	res := (&Checker{Scheme: "http"}).CheckWith(context.Background(), ref, Options{Roots: rootsFrom(ts.root), Identities: []KeylessIdentity{
		{Source: "Kyverno ClusterPolicy private", Subject: "release@acme.dev", Unsupported: "it trusts its own Fulcio roots"},
	}})
	if res.Verification != VerifiedKeyless || !strings.Contains(res.Reason, "its own Fulcio") {
		t.Errorf("got %+v", res)
	}
}
