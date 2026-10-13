package sigcheck

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

// Verification is what checking a found signature against the cluster's
// own policy keys concluded.
type Verification string

const (
	// VerifiedOK: a policy key verifies a signature whose payload names this digest.
	VerifiedOK Verification = "verified"
	// VerifiedFailed: there were keys for this image and none verified.
	VerifiedFailed Verification = "failed"
	// VerifiedKeyless: signed with a Fulcio certificate, and no policy
	// identity judged the signer. With trust roots, the signature, chain, SCT
	// and Rekor entry were checked and Signer names who signed; without them
	// (offline), nothing was checked and Reason says why.
	VerifiedKeyless Verification = "keyless"
	// VerifiedNoKey: signed, but no policy key covers this image.
	VerifiedNoKey Verification = "no-key"
)

// Credentials for one registry, from a pod's imagePullSecrets. Sent only to
// that registry and the token service it names, never logged or cached.
type Credentials struct {
	Username string
	Password string
}

// PublicKey is a verification key taken from an admission policy, with the
// image patterns that policy applies it to.
type PublicKey struct {
	Key    crypto.PublicKey
	Source string
	Images []string
}

type Options struct {
	Keys  []PublicKey
	Creds *Credentials
	// Identities are the keyless signers policies accept for this image.
	Identities []KeylessIdentity
	// Roots loads Sigstore's trusted root, only when a keyless signature
	// turns up. Nil leaves keyless signatures unchecked, as before.
	Roots func(context.Context) (*TrustedRoot, string, error)
}

// ParsePublicKeys reads every PEM public key in text (policies often hold several).
func ParsePublicKeys(text, source string, images []string) ([]PublicKey, error) {
	var out []PublicKey
	rest := []byte(text)
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		k, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", source, err)
		}
		out = append(out, PublicKey{Key: k, Source: source, Images: images})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s: no PEM public key", source)
	}
	return out, nil
}

// AppliesTo reports whether the policy uses this key for image. A key with
// no pattern applies to every image. "*" matches across path segments, as
// in Kyverno imageReferences; "**" in Sigstore globs means the same here.
func (k PublicKey) AppliesTo(image string) bool { return imagesMatch(k.Images, image) }

func imagesMatch(patterns []string, image string) bool {
	if len(patterns) == 0 {
		return true
	}
	for _, p := range patterns {
		re := "^" + strings.ReplaceAll(regexp.QuoteMeta(p), `\*`, ".*") + "$"
		if ok, _ := regexp.MatchString(re, image); ok {
			return true
		}
	}
	return false
}

func verifySig(key crypto.PublicKey, payload, sig []byte) bool {
	h := sha256.Sum256(payload)
	switch k := key.(type) {
	case *ecdsa.PublicKey:
		return ecdsa.VerifyASN1(k, h[:], sig)
	case *rsa.PublicKey:
		return rsa.VerifyPKCS1v15(k, crypto.SHA256, h[:], sig) == nil || rsa.VerifyPSS(k, crypto.SHA256, h[:], sig, nil) == nil
	case ed25519.PublicKey:
		return ed25519.Verify(k, payload, sig)
	}
	return false
}

type sigManifest struct {
	Layers []struct {
		MediaType   string            `json:"mediaType"`
		Digest      string            `json:"digest"`
		Annotations map[string]string `json:"annotations"`
	} `json:"layers"`
}

const (
	annSignature   = "dev.cosignproject.cosign/signature"
	annCertificate = "dev.sigstore.cosign/certificate"
)

// tagVerdict is what checking a cosign .sig manifest concluded.
type tagVerdict struct {
	v      Verification
	by     string
	reason string
	signer Signer
	// transient: keyless signatures went unchecked for want of trust roots,
	// so the answer may change once they load; don't cache it.
	transient bool
}

// verifyTag checks the signatures in a cosign .sig manifest. Each layer is a
// simple-signing payload, whose blob must hash to the layer digest and name
// this image's digest. A layer signed with a key must verify with a policy
// key; a keyless layer must pass verifyKeyless, and its signer must be one
// a policy identity accepts.
func verifyTag(ctx context.Context, s *session, ref Ref, manifest []byte, opts Options) tagVerdict {
	var m sigManifest
	if err := json.Unmarshal(manifest, &m); err != nil {
		return tagVerdict{v: VerifiedFailed, reason: "the signature manifest isn't readable"}
	}
	keyless := false
	for _, l := range m.Layers {
		if l.Annotations[annCertificate] != "" {
			keyless = true
		}
	}
	checkKeyless := keyless && opts.Roots != nil
	if len(opts.Keys) == 0 && !checkKeyless {
		if keyless {
			return tagVerdict{v: VerifiedKeyless, reason: "keyless signature: its identity is checked by the admission controller, not here"}
		}
		return tagVerdict{v: VerifiedNoKey, reason: "no policy key covers this image"}
	}
	reason := "no signature verifies with the policy keys"
	var (
		root        *TrustedRoot
		rootErr     error
		rootLoaded  bool
		signed      *Signer
		unsupported string
	)
	judged := false
	for _, id := range opts.Identities {
		if id.Unsupported == "" {
			judged = true
		} else if unsupported == "" {
			unsupported = id.Source + ": " + id.Unsupported
		}
	}
	for _, l := range m.Layers {
		sig, err := base64.StdEncoding.DecodeString(l.Annotations[annSignature])
		if err != nil || len(sig) == 0 || !strings.HasPrefix(l.Digest, "sha256:") {
			continue
		}
		code, blob, err := s.get(ctx, "/blobs/"+l.Digest, "*/*")
		sum := sha256.Sum256(blob)
		if err != nil || code != http.StatusOK || fmt.Sprintf("sha256:%x", sum) != l.Digest {
			continue
		}
		var p struct {
			Critical struct {
				Image struct {
					Digest string `json:"docker-manifest-digest"`
				} `json:"image"`
			} `json:"critical"`
		}
		if json.Unmarshal(blob, &p) != nil {
			continue
		}
		if p.Critical.Image.Digest != ref.Digest {
			reason = "the signature is for a different image digest"
			continue
		}
		for _, k := range opts.Keys {
			if verifySig(k.Key, blob, sig) {
				return tagVerdict{v: VerifiedOK, by: k.Source}
			}
		}
		if l.Annotations[annCertificate] == "" || !checkKeyless {
			continue
		}
		if !rootLoaded {
			root, _, rootErr = opts.Roots(ctx)
			rootLoaded = true
		}
		if rootErr != nil {
			continue
		}
		signer, err := verifyKeyless(root, l.Annotations, sig, sum[:], blob)
		if err != nil {
			reason = err.Error()
			continue
		}
		signed = &signer
		for _, id := range opts.Identities {
			if id.Unsupported == "" && id.Matches(signer) {
				return tagVerdict{v: VerifiedOK, by: id.Source, signer: signer}
			}
		}
	}
	switch {
	case signed != nil && judged:
		return tagVerdict{v: VerifiedFailed, signer: *signed, reason: fmt.Sprintf("signed by %s (issuer %s), which no policy identity for this image allows", signed.Subject, signed.Issuer)}
	case signed != nil && unsupported != "":
		return tagVerdict{v: VerifiedKeyless, signer: *signed, reason: fmt.Sprintf("signature verified against Sigstore's public roots; not judged against %s", unsupported)}
	case signed != nil:
		return tagVerdict{v: VerifiedKeyless, signer: *signed, reason: "signature verified against Sigstore's public roots; no policy names a signer for this image"}
	case rootErr != nil && len(opts.Keys) == 0:
		return tagVerdict{v: VerifiedKeyless, transient: true, reason: "keyless signature not checked: Sigstore's trust roots couldn't be loaded: " + rootErr.Error()}
	}
	return tagVerdict{v: VerifiedFailed, reason: reason}
}

// cacheKey separates results by whether credentials were used and which
// keys were tried, since both change the answer.
func cacheKey(ref Ref, opts Options) string {
	srcs := make([]string, 0, len(opts.Keys))
	for _, k := range opts.Keys {
		srcs = append(srcs, k.Source)
	}
	sort.Strings(srcs)
	ids := make([]string, 0, len(opts.Identities))
	for _, id := range opts.Identities {
		ids = append(ids, id.Source)
	}
	sort.Strings(ids)
	return fmt.Sprintf("%s/%s@%s|auth=%t|keys=%s|ids=%s|roots=%t", ref.Registry, ref.Repo, ref.Digest, opts.Creds != nil, strings.Join(srcs, ","), strings.Join(ids, ","), opts.Roots != nil)
}
