package sigcheck

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	annChain  = "dev.sigstore.cosign/chain"
	annBundle = "dev.sigstore.cosign/bundle"
)

var (
	// Fulcio's OIDC issuer extensions: 1.1 holds the raw string, 1.8 a DER UTF8String.
	oidIssuerV1 = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 57264, 1, 1}
	oidIssuerV2 = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 57264, 1, 8}
	// RFC 6962 embedded SCT list.
	oidSCTList = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 11129, 2, 4, 2}
)

// Signer is who a keyless signature's certificate names, and when Rekor
// logged the signature.
type Signer struct {
	Subject  string
	Issuer   string
	LoggedAt time.Time
}

// KeylessIdentity is a signer an admission policy accepts for some images.
// Empty fields don't constrain; regexps match anywhere, as cosign's do.
type KeylessIdentity struct {
	Source        string
	Images        []string
	Issuer        string
	Subject       string
	IssuerRegExp  string
	SubjectRegExp string
	// Wildcards: "*" in Subject and Issuer matches anything (Kyverno).
	Wildcards bool
	// Unsupported, when set, is why Kubebay can't judge this identity (the
	// policy trusts its own Fulcio or Rekor, not Sigstore's public ones).
	Unsupported string
}

func (k KeylessIdentity) AppliesTo(image string) bool { return imagesMatch(k.Images, image) }

func (k KeylessIdentity) Matches(s Signer) bool {
	return fieldMatches(k.Subject, k.SubjectRegExp, s.Subject, k.Wildcards) && fieldMatches(k.Issuer, k.IssuerRegExp, s.Issuer, k.Wildcards)
}

func fieldMatches(exact, re, v string, wildcards bool) bool {
	if exact != "" {
		if wildcards && strings.Contains(exact, "*") {
			pat := "^" + strings.ReplaceAll(regexp.QuoteMeta(exact), `\*`, ".*") + "$"
			if ok, _ := regexp.MatchString(pat, v); !ok {
				return false
			}
		} else if exact != v {
			return false
		}
	}
	if re != "" {
		r, err := regexp.Compile(re)
		if err != nil || !r.MatchString(v) {
			return false
		}
	}
	return true
}

// rekorPayload is what a Rekor signed entry timestamp covers.
type rekorPayload struct {
	Body           string `json:"body"`
	IntegratedTime int64  `json:"integratedTime"`
	LogIndex       int64  `json:"logIndex"`
	LogID          string `json:"logID"`
}

// canonical is the RFC 8785 form Rekor signs: keys sorted, no whitespace.
// The struct below lists the keys in sorted order; body and logID are
// base64 and hex, so nothing in them escapes differently.
func (p rekorPayload) canonical() ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	err := enc.Encode(struct {
		Body           string `json:"body"`
		IntegratedTime int64  `json:"integratedTime"`
		LogID          string `json:"logID"`
		LogIndex       int64  `json:"logIndex"`
	}{p.Body, p.IntegratedTime, p.LogID, p.LogIndex})
	return bytes.TrimRight(b.Bytes(), "\n"), err
}

func verifyWith(key crypto.PublicKey, msg, sig []byte) bool {
	switch k := key.(type) {
	case *ecdsa.PublicKey:
		h := sha256.Sum256(msg)
		return ecdsa.VerifyASN1(k, h[:], sig)
	case *rsa.PublicKey:
		h := sha256.Sum256(msg)
		return rsa.VerifyPKCS1v15(k, crypto.SHA256, h[:], sig) == nil
	case ed25519.PublicKey:
		return ed25519.Verify(k, msg, sig)
	}
	return false
}

// verifyDigest checks sig over a payload known by its SHA-256 digest. An
// Ed25519 key signs the message itself, so it needs the payload.
func verifyDigest(key crypto.PublicKey, digest, sig, payload []byte) bool {
	switch k := key.(type) {
	case *ecdsa.PublicKey:
		return ecdsa.VerifyASN1(k, digest, sig)
	case *rsa.PublicKey:
		return rsa.VerifyPKCS1v15(k, crypto.SHA256, digest, sig) == nil || rsa.VerifyPSS(k, crypto.SHA256, digest, sig, nil) == nil
	case ed25519.PublicKey:
		h := sha256.Sum256(payload)
		return payload != nil && bytes.Equal(h[:], digest) && ed25519.Verify(k, payload, sig)
	}
	return false
}

type rekorBody struct {
	Kind string `json:"kind"`
	Spec struct {
		Data struct {
			Hash struct {
				Algorithm string `json:"algorithm"`
				Value     string `json:"value"`
			} `json:"hash"`
		} `json:"data"`
		Signature struct {
			Content   []byte `json:"content"`
			PublicKey struct {
				Content []byte `json:"content"`
			} `json:"publicKey"`
		} `json:"signature"`
	} `json:"spec"`
}

// verifyKeyless checks one keyless cosign signature the way cosign does
// against Sigstore's public instance:
//   - the Rekor entry's signed timestamp verifies with a log key in the
//     trusted root, valid when the entry was logged;
//   - the entry records this payload digest, this signature and this
//     certificate;
//   - the certificate chains to a Fulcio CA in the trusted root at the time
//     Rekor logged it (Fulcio certificates live ten minutes);
//   - it carries an SCT from a CT log in the trusted root;
//   - the signature verifies with the certificate's key.
//
// It returns who the certificate names. Whether that signer is acceptable
// is the caller's question.
func verifyKeyless(root *TrustedRoot, ann map[string]string, sig, digest, payload []byte) (Signer, error) {
	block, _ := pem.Decode([]byte(ann[annCertificate]))
	if block == nil {
		return Signer{}, errors.New("the signing certificate isn't readable")
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return Signer{}, fmt.Errorf("the signing certificate isn't readable: %w", err)
	}
	if ann[annBundle] == "" {
		return Signer{}, errors.New("no transparency log entry, so the certificate's time can't be checked")
	}
	var bundle struct {
		SignedEntryTimestamp []byte       `json:"SignedEntryTimestamp"`
		Payload              rekorPayload `json:"Payload"`
	}
	if err := json.Unmarshal([]byte(ann[annBundle]), &bundle); err != nil {
		return Signer{}, fmt.Errorf("the transparency log entry isn't readable: %w", err)
	}
	at := time.Unix(bundle.Payload.IntegratedTime, 0)

	// 1. Rekor vouches for the entry and its time.
	id, _ := hex.DecodeString(bundle.Payload.LogID)
	var tlog *TransparencyLog
	for i := range root.Tlogs {
		if bytes.Equal(root.Tlogs[i].ID, id) && validAt(root.Tlogs[i].Start, root.Tlogs[i].End, at) {
			tlog = &root.Tlogs[i]
		}
	}
	if tlog == nil {
		return Signer{}, errors.New("its transparency log entry is from a Rekor log the trusted root doesn't list")
	}
	canon, err := bundle.Payload.canonical()
	if err != nil || !verifyWith(tlog.Key, canon, bundle.SignedEntryTimestamp) {
		return Signer{}, errors.New("the transparency log's signed entry timestamp doesn't verify with Rekor's key")
	}

	// 2. The entry is about this payload, signature and certificate.
	raw, err := base64.StdEncoding.DecodeString(bundle.Payload.Body)
	var body rekorBody
	if err != nil || json.Unmarshal(raw, &body) != nil {
		return Signer{}, errors.New("the transparency log entry isn't readable")
	}
	if body.Kind != "hashedrekord" && body.Kind != "rekord" {
		return Signer{}, fmt.Errorf("the transparency log entry is a %q, not a signature", body.Kind)
	}
	if !strings.EqualFold(body.Spec.Data.Hash.Algorithm, "sha256") || body.Spec.Data.Hash.Value != hex.EncodeToString(digest) {
		return Signer{}, errors.New("the transparency log entry is for a different payload")
	}
	if !bytes.Equal(body.Spec.Signature.Content, sig) {
		return Signer{}, errors.New("the transparency log entry is for a different signature")
	}
	if logged, _ := pem.Decode(body.Spec.Signature.PublicKey.Content); logged == nil || !bytes.Equal(logged.Bytes, leaf.Raw) {
		return Signer{}, errors.New("the transparency log entry is for a different certificate")
	}

	// 3. Fulcio issued the certificate, valid at the logged time.
	var issuer *x509.Certificate
	for _, ca := range root.CAs {
		if !validAt(ca.Start, ca.End, at) {
			continue
		}
		roots, inter := x509.NewCertPool(), x509.NewCertPool()
		roots.AddCert(ca.Certs[len(ca.Certs)-1])
		for _, c := range ca.Certs[:len(ca.Certs)-1] {
			inter.AddCert(c)
		}
		chains, err := leaf.Verify(x509.VerifyOptions{Roots: roots, Intermediates: inter, CurrentTime: at, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageCodeSigning}})
		if err == nil && len(chains) > 0 && len(chains[0]) > 1 {
			issuer = chains[0][1]
			break
		}
	}
	if issuer == nil {
		return Signer{}, errors.New("the certificate wasn't issued by a Fulcio CA in the trusted root")
	}

	// 4. A certificate transparency log saw it.
	if err := verifySCT(leaf, issuer, root.CTLogs); err != nil {
		return Signer{}, err
	}

	// 5. The signature itself.
	if !verifyDigest(leaf.PublicKey, digest, sig, payload) {
		return Signer{}, errors.New("the signature doesn't verify with the certificate's key")
	}

	s := Signer{Issuer: certIssuer(leaf), LoggedAt: at}
	switch {
	case len(leaf.EmailAddresses) > 0:
		s.Subject = leaf.EmailAddresses[0]
	case len(leaf.URIs) > 0:
		s.Subject = leaf.URIs[0].String()
	default:
		return Signer{}, errors.New("the certificate names no signer")
	}
	return s, nil
}

func certIssuer(c *x509.Certificate) string {
	v1 := ""
	for _, e := range c.Extensions {
		switch {
		case e.Id.Equal(oidIssuerV2):
			var s string
			if _, err := asn1.UnmarshalWithParams(e.Value, &s, "utf8"); err == nil {
				return s
			}
		case e.Id.Equal(oidIssuerV1):
			v1 = string(e.Value)
		}
	}
	return v1
}

// verifySCT checks the certificate's embedded SCTs (RFC 6962 §3.2): at
// least one must be signed by a CT log in the trusted root over the
// precertificate, which is the certificate without its SCT list.
func verifySCT(leaf, issuer *x509.Certificate, logs []TransparencyLog) error {
	var ext []byte
	for _, e := range leaf.Extensions {
		if e.Id.Equal(oidSCTList) {
			ext = e.Value
		}
	}
	if ext == nil {
		return errors.New("the certificate has no SCT from a certificate transparency log")
	}
	var list []byte
	if _, err := asn1.Unmarshal(ext, &list); err != nil || len(list) < 2 || int(binary.BigEndian.Uint16(list)) != len(list)-2 {
		return errors.New("the certificate's SCT list isn't readable")
	}
	tbs, err := tbsWithoutSCT(leaf.RawTBSCertificate)
	if err != nil {
		return fmt.Errorf("the certificate's SCT can't be checked: %w", err)
	}
	ikh := sha256.Sum256(issuer.RawSubjectPublicKeyInfo)
	for rest := list[2:]; len(rest) >= 2; {
		n := int(binary.BigEndian.Uint16(rest))
		if len(rest) < 2+n {
			break
		}
		sct := rest[2 : 2+n]
		rest = rest[2+n:]
		// version(1) log_id(32) timestamp(8) extensions(2+n) hash(1) sig(1) signature(2+n)
		if len(sct) < 43 || sct[0] != 0 {
			continue
		}
		logID, ts := sct[1:33], binary.BigEndian.Uint64(sct[33:41])
		el := int(binary.BigEndian.Uint16(sct[41:43]))
		if len(sct) < 43+el+4 {
			continue
		}
		exts := sct[43 : 43+el]
		sl := int(binary.BigEndian.Uint16(sct[43+el+2:]))
		if len(sct) < 43+el+4+sl {
			continue
		}
		sig := sct[43+el+4 : 43+el+4+sl]
		signed := []byte{0, 0}
		signed = binary.BigEndian.AppendUint64(signed, ts)
		signed = append(signed, 0, 1)
		signed = append(signed, ikh[:]...)
		signed = append(signed, byte(len(tbs)>>16), byte(len(tbs)>>8), byte(len(tbs)))
		signed = append(signed, tbs...)
		signed = binary.BigEndian.AppendUint16(signed, uint16(len(exts)))
		signed = append(signed, exts...)
		when := time.UnixMilli(int64(ts))
		for _, l := range logs {
			if bytes.Equal(l.ID, logID) && validAt(l.Start, l.End, when) && verifyWith(l.Key, signed, sig) {
				return nil
			}
		}
	}
	return errors.New("no SCT in the certificate verifies with a certificate transparency log in the trusted root")
}

// tbsWithoutSCT re-encodes a TBSCertificate without its SCT list extension.
func tbsWithoutSCT(raw []byte) ([]byte, error) {
	var tbs asn1.RawValue
	if _, err := asn1.Unmarshal(raw, &tbs); err != nil {
		return nil, err
	}
	var out []byte
	for inner := tbs.Bytes; len(inner) > 0; {
		var el asn1.RawValue
		var err error
		if inner, err = asn1.Unmarshal(inner, &el); err != nil {
			return nil, err
		}
		if el.Class != asn1.ClassContextSpecific || el.Tag != 3 {
			out = append(out, el.FullBytes...)
			continue
		}
		var seq asn1.RawValue
		if _, err := asn1.Unmarshal(el.Bytes, &seq); err != nil {
			return nil, err
		}
		var kept []byte
		for e := seq.Bytes; len(e) > 0; {
			var one asn1.RawValue
			if e, err = asn1.Unmarshal(e, &one); err != nil {
				return nil, err
			}
			var x pkix.Extension
			if _, err := asn1.Unmarshal(one.FullBytes, &x); err != nil {
				return nil, err
			}
			if !x.Id.Equal(oidSCTList) {
				kept = append(kept, one.FullBytes...)
			}
		}
		seqDER, err := asn1.Marshal(asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: kept})
		if err != nil {
			return nil, err
		}
		wrapped, err := asn1.Marshal(asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 3, IsCompound: true, Bytes: seqDER})
		if err != nil {
			return nil, err
		}
		out = append(out, wrapped...)
	}
	return asn1.Marshal(asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: out})
}
