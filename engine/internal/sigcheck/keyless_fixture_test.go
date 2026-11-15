package sigcheck

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"testing"
	"time"
)

// testSigstore is a private Fulcio, CT log and Rekor, so the whole check can
// run over a payload the test controls. The real fixtures prove the formats;
// this proves the flow.
type testSigstore struct {
	root            *TrustedRoot
	ca, inter       *x509.Certificate
	interKey        *ecdsa.PrivateKey
	ctKey, rekorKey *ecdsa.PrivateKey
	ctID, rekorID   []byte
}

func genKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func logID(t *testing.T, k *ecdsa.PrivateKey) []byte {
	der, err := x509.MarshalPKIXPublicKey(&k.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(der)
	return h[:]
}

func mkCert(t *testing.T, tmpl, parent *x509.Certificate, pub any, key *ecdsa.PrivateKey) *x509.Certificate {
	t.Helper()
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, pub, key)
	if err != nil {
		t.Fatal(err)
	}
	c, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func newTestSigstore(t *testing.T) *testSigstore {
	t.Helper()
	start := time.Now().Add(-24 * time.Hour)
	caKey, interKey := genKey(t), genKey(t)
	caT := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test-fulcio"}, NotBefore: start, NotAfter: start.Add(10 * 365 * 24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	ca := mkCert(t, caT, caT, &caKey.PublicKey, caKey)
	interT := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "test-fulcio-intermediate"}, NotBefore: start, NotAfter: caT.NotAfter,
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageCodeSigning}}
	inter := mkCert(t, interT, ca, &interKey.PublicKey, caKey)
	ts := &testSigstore{ca: ca, inter: inter, interKey: interKey, ctKey: genKey(t), rekorKey: genKey(t)}
	ts.ctID, ts.rekorID = logID(t, ts.ctKey), logID(t, ts.rekorKey)
	ts.root = &TrustedRoot{
		CAs:    []CertAuthority{{URI: "https://fulcio.test", Certs: []*x509.Certificate{inter, ca}, Start: start}},
		Tlogs:  []TransparencyLog{{URL: "https://rekor.test", ID: ts.rekorID, Key: &ts.rekorKey.PublicKey, Start: start}},
		CTLogs: []TransparencyLog{{URL: "https://ct.test", ID: ts.ctID, Key: &ts.ctKey.PublicKey, Start: start}},
	}
	return ts
}

// sign returns the layer annotations cosign writes for a keyless signature
// of payload by email, issued by issuer, logged at "at".
func (ts *testSigstore) sign(t *testing.T, payload []byte, email, issuer string, at time.Time) (map[string]string, []byte) {
	t.Helper()
	leafKey := genKey(t)
	issuerDER, _ := asn1.MarshalWithParams(issuer, "utf8")
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(at.UnixNano()), NotBefore: at.Add(-time.Minute), NotAfter: at.Add(9 * time.Minute),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageCodeSigning}, EmailAddresses: []string{email},
		ExtraExtensions: []pkix.Extension{{Id: oidIssuerV2, Value: issuerDER}}}
	pre := mkCert(t, tmpl, ts.inter, &leafKey.PublicKey, ts.interKey)

	// The SCT signs the TBS without itself, as RFC 6962 precertificates do.
	ms := uint64(at.UnixMilli())
	ikh := sha256.Sum256(ts.inter.RawSubjectPublicKeyInfo)
	signed := []byte{0, 0}
	signed = binary.BigEndian.AppendUint64(signed, ms)
	signed = append(signed, 0, 1)
	signed = append(signed, ikh[:]...)
	n := len(pre.RawTBSCertificate)
	signed = append(signed, byte(n>>16), byte(n>>8), byte(n))
	signed = append(signed, pre.RawTBSCertificate...)
	signed = append(signed, 0, 0)
	h := sha256.Sum256(signed)
	ctSig, err := ecdsa.SignASN1(rand.Reader, ts.ctKey, h[:])
	if err != nil {
		t.Fatal(err)
	}
	sct := []byte{0}
	sct = append(sct, ts.ctID...)
	sct = binary.BigEndian.AppendUint64(sct, ms)
	sct = append(sct, 0, 0, 4, 3)
	sct = binary.BigEndian.AppendUint16(sct, uint16(len(ctSig)))
	sct = append(sct, ctSig...)
	list := binary.BigEndian.AppendUint16(nil, uint16(len(sct)+2))
	list = binary.BigEndian.AppendUint16(list, uint16(len(sct)))
	list = append(list, sct...)
	listDER, _ := asn1.Marshal(list)
	tmpl.ExtraExtensions = append(tmpl.ExtraExtensions, pkix.Extension{Id: oidSCTList, Value: listDER})
	leaf := mkCert(t, tmpl, ts.inter, &leafKey.PublicKey, ts.interKey)
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf.Raw})

	ph := sha256.Sum256(payload)
	sig, err := ecdsa.SignASN1(rand.Reader, leafKey, ph[:])
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"apiVersion": "0.0.1", "kind": "hashedrekord", "spec": map[string]any{
		"data":      map[string]any{"hash": map[string]any{"algorithm": "sha256", "value": hex.EncodeToString(ph[:])}},
		"signature": map[string]any{"content": base64.StdEncoding.EncodeToString(sig), "publicKey": map[string]any{"content": base64.StdEncoding.EncodeToString(leafPEM)}},
	}})
	p := rekorPayload{Body: base64.StdEncoding.EncodeToString(body), IntegratedTime: at.Unix(), LogIndex: 7, LogID: hex.EncodeToString(ts.rekorID)}
	canon, err := p.canonical()
	if err != nil {
		t.Fatal(err)
	}
	ch := sha256.Sum256(canon)
	set, err := ecdsa.SignASN1(rand.Reader, ts.rekorKey, ch[:])
	if err != nil {
		t.Fatal(err)
	}
	bundle, _ := json.Marshal(map[string]any{"SignedEntryTimestamp": base64.StdEncoding.EncodeToString(set), "Payload": p})
	chain := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ts.inter.Raw})) + string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ts.ca.Raw}))
	return map[string]string{annCertificate: string(leafPEM), annChain: chain, annBundle: string(bundle)}, sig
}

// testLeafPEM is a certificate no trusted root issued.
func testLeafPEM(t *testing.T) string {
	k := genKey(t)
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(9), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), EmailAddresses: []string{"mallory@example.com"}}
	c := mkCert(t, tmpl, tmpl, &k.PublicKey, k)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Raw}))
}
