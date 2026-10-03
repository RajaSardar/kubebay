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
	// VerifiedKeyless: signed with a Fulcio certificate; checking the identity
	// and the transparency log is the admission controller's job, not done here.
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
func (k PublicKey) AppliesTo(image string) bool {
	if len(k.Images) == 0 {
		return true
	}
	for _, p := range k.Images {
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

// verifyTag checks the signatures in a cosign .sig manifest: each layer is a
// simple-signing payload, whose blob must hash to the layer digest and name
// this image's digest, and whose signature one of keys must verify.
func verifyTag(ctx context.Context, s *session, ref Ref, manifest []byte, keys []PublicKey) (Verification, string, string) {
	var m sigManifest
	if err := json.Unmarshal(manifest, &m); err != nil {
		return VerifiedFailed, "", "the signature manifest isn't readable"
	}
	keyless := false
	for _, l := range m.Layers {
		if l.Annotations[annCertificate] != "" {
			keyless = true
		}
	}
	if len(keys) == 0 {
		if keyless {
			return VerifiedKeyless, "", "keyless signature: its identity is checked by the admission controller, not here"
		}
		return VerifiedNoKey, "", "no policy key covers this image"
	}
	reason := "no signature verifies with the policy keys"
	for _, l := range m.Layers {
		sig, err := base64.StdEncoding.DecodeString(l.Annotations[annSignature])
		if err != nil || len(sig) == 0 || !strings.HasPrefix(l.Digest, "sha256:") {
			continue
		}
		code, blob, err := s.get(ctx, "/blobs/"+l.Digest, "*/*")
		if err != nil || code != http.StatusOK || fmt.Sprintf("sha256:%x", sha256.Sum256(blob)) != l.Digest {
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
		for _, k := range keys {
			if verifySig(k.Key, blob, sig) {
				return VerifiedOK, k.Source, ""
			}
		}
	}
	return VerifiedFailed, "", reason
}

// cacheKey separates results by whether credentials were used and which
// keys were tried, since both change the answer.
func cacheKey(ref Ref, opts Options) string {
	srcs := make([]string, 0, len(opts.Keys))
	for _, k := range opts.Keys {
		srcs = append(srcs, k.Source)
	}
	sort.Strings(srcs)
	return fmt.Sprintf("%s/%s@%s|auth=%t|keys=%s", ref.Registry, ref.Repo, ref.Digest, opts.Creds != nil, strings.Join(srcs, ","))
}
