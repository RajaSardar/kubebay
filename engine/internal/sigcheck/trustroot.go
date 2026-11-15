package sigcheck

import (
	"crypto"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// TrustedRoot is a Sigstore trusted root: the Fulcio certificate
// authorities, Rekor transparency logs and certificate transparency logs a
// keyless signature is checked against, each with the window it was valid in.
type TrustedRoot struct {
	CAs    []CertAuthority
	Tlogs  []TransparencyLog
	CTLogs []TransparencyLog
}

type CertAuthority struct {
	URI string
	// Certs runs from the issuing certificate to the self-signed root.
	Certs      []*x509.Certificate
	Start, End time.Time
}

type TransparencyLog struct {
	URL string
	// ID is the log's key ID as the trusted root publishes it.
	ID         []byte
	Key        crypto.PublicKey
	Start, End time.Time
}

// validAt reports whether t falls in [start, end], an open end meaning still valid.
func validAt(start, end, t time.Time) bool {
	return !t.Before(start) && (end.IsZero() || !t.After(end))
}

type rootJSON struct {
	MediaType string    `json:"mediaType"`
	Tlogs     []logJSON `json:"tlogs"`
	CTLogs    []logJSON `json:"ctlogs"`
	CAs       []struct {
		URI       string `json:"uri"`
		CertChain struct {
			Certificates []struct {
				RawBytes []byte `json:"rawBytes"`
			} `json:"certificates"`
		} `json:"certChain"`
		ValidFor window `json:"validFor"`
	} `json:"certificateAuthorities"`
}

type window struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

type logJSON struct {
	BaseURL   string `json:"baseUrl"`
	PublicKey struct {
		RawBytes []byte `json:"rawBytes"`
		ValidFor window `json:"validFor"`
	} `json:"publicKey"`
	LogID struct {
		KeyID []byte `json:"keyId"`
	} `json:"logId"`
}

func parseLogs(in []logJSON) ([]TransparencyLog, error) {
	var out []TransparencyLog
	for _, l := range in {
		k, err := x509.ParsePKIXPublicKey(l.PublicKey.RawBytes)
		if err != nil {
			return nil, fmt.Errorf("log %s: %w", l.BaseURL, err)
		}
		out = append(out, TransparencyLog{URL: l.BaseURL, ID: l.LogID.KeyID, Key: k, Start: l.PublicKey.ValidFor.Start, End: l.PublicKey.ValidFor.End})
	}
	return out, nil
}

// ParseTrustedRoot reads a trusted_root.json (Sigstore's protobuf-specs
// TrustedRoot in JSON form).
func ParseTrustedRoot(b []byte) (*TrustedRoot, error) {
	var j rootJSON
	if err := json.Unmarshal(b, &j); err != nil {
		return nil, fmt.Errorf("trusted root: %w", err)
	}
	if !strings.HasPrefix(j.MediaType, "application/vnd.dev.sigstore.trustedroot") {
		return nil, fmt.Errorf("trusted root: unexpected media type %q", j.MediaType)
	}
	r := &TrustedRoot{}
	var err error
	if r.Tlogs, err = parseLogs(j.Tlogs); err != nil {
		return nil, err
	}
	if r.CTLogs, err = parseLogs(j.CTLogs); err != nil {
		return nil, err
	}
	for _, ca := range j.CAs {
		a := CertAuthority{URI: ca.URI, Start: ca.ValidFor.Start, End: ca.ValidFor.End}
		for _, c := range ca.CertChain.Certificates {
			cert, err := x509.ParseCertificate(c.RawBytes)
			if err != nil {
				return nil, fmt.Errorf("certificate authority %s: %w", ca.URI, err)
			}
			a.Certs = append(a.Certs, cert)
		}
		if len(a.Certs) == 0 {
			return nil, fmt.Errorf("certificate authority %s has no certificates", ca.URI)
		}
		r.CAs = append(r.CAs, a)
	}
	return r, nil
}
