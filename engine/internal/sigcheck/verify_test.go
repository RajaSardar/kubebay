package sigcheck

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newKey(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(&k.PublicKey)
	return k, string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}

func payloadFor(dig string) []byte {
	return []byte(fmt.Sprintf(`{"critical":{"identity":{"docker-reference":"reg/org/app"},"image":{"docker-manifest-digest":%q},"type":"cosign container image signature"},"optional":null}`, dig))
}

type sigRegistry struct {
	payload     []byte
	sig         []byte
	cert        bool
	needsBasic  string // "user:pass" required on every request when set
	srv         *httptest.Server
	sawAuthOnly bool
}

func (r *sigRegistry) serve(t *testing.T) *httptest.Server {
	t.Helper()
	blobDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(r.payload))
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/", func(w http.ResponseWriter, req *http.Request) {
		if r.needsBasic != "" {
			want := "Basic " + base64.StdEncoding.EncodeToString([]byte(r.needsBasic))
			if req.Header.Get("Authorization") != want {
				w.Header().Set("WWW-Authenticate", `Basic realm="reg"`)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
		}
		switch {
		case strings.HasSuffix(req.URL.Path, ".sig"):
			ann := map[string]string{"dev.cosignproject.cosign/signature": base64.StdEncoding.EncodeToString(r.sig)}
			if r.cert {
				ann["dev.sigstore.cosign/certificate"] = "-----BEGIN CERTIFICATE-----"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"schemaVersion": 2,
				"layers":        []any{map[string]any{"mediaType": "application/vnd.dev.cosign.simplesigning.v1+json", "digest": blobDigest, "size": len(r.payload), "annotations": ann}},
			})
		case strings.HasSuffix(req.URL.Path, "/blobs/"+blobDigest):
			_, _ = w.Write(r.payload)
		default:
			http.NotFound(w, req)
		}
	})
	r.srv = httptest.NewServer(mux)
	t.Cleanup(r.srv.Close)
	return r.srv
}

func sign(t *testing.T, k *ecdsa.PrivateKey, payload []byte) []byte {
	t.Helper()
	h := sha256.Sum256(payload)
	sig, err := ecdsa.SignASN1(rand.Reader, k, h[:])
	if err != nil {
		t.Fatal(err)
	}
	return sig
}

func sigRef(srv *httptest.Server) Ref {
	return Ref{Registry: strings.TrimPrefix(srv.URL, "http://"), Repo: "org/app", Digest: digest}
}

func mustKeys(t *testing.T, source string, pems ...string) []PublicKey {
	t.Helper()
	var out []PublicKey
	for _, p := range pems {
		k, err := ParsePublicKeys(p, source, nil)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, k...)
	}
	return out
}

func TestVerifiesACosignSignatureWithThePolicyKey(t *testing.T) {
	k, pub := newKey(t)
	reg := &sigRegistry{payload: payloadFor(digest)}
	reg.sig = sign(t, k, reg.payload)
	srv := reg.serve(t)
	c := &Checker{Scheme: "http"}
	res := c.CheckWith(context.Background(), sigRef(srv), Options{Keys: mustKeys(t, "kyverno ClusterPolicy verify-acme", pub)})
	if res.Status != StatusSigned || res.Verification != VerifiedOK || res.VerifiedBy != "kyverno ClusterPolicy verify-acme" {
		t.Errorf("got %+v", res)
	}
}

func TestAWrongKeyOrAnotherImagesPayloadFailsVerification(t *testing.T) {
	signer, _ := newKey(t)
	_, other := newKey(t)
	reg := &sigRegistry{payload: payloadFor(digest)}
	reg.sig = sign(t, signer, reg.payload)
	srv := reg.serve(t)
	c := &Checker{Scheme: "http"}
	if res := c.CheckWith(context.Background(), sigRef(srv), Options{Keys: mustKeys(t, "p", other)}); res.Verification != VerifiedFailed {
		t.Errorf("wrong key: %+v", res)
	}

	k, pub := newKey(t)
	moved := &sigRegistry{payload: payloadFor("sha256:" + strings.Repeat("0", 64))}
	moved.sig = sign(t, k, moved.payload)
	srv2 := moved.serve(t)
	res := (&Checker{Scheme: "http"}).CheckWith(context.Background(), sigRef(srv2), Options{Keys: mustKeys(t, "p", pub)})
	if res.Verification != VerifiedFailed || !strings.Contains(res.Reason, "different image") {
		t.Errorf("a signature for another digest must not verify this one: %+v", res)
	}
}

func TestKeylessSignaturesAreNamedNotVerified(t *testing.T) {
	k, _ := newKey(t)
	reg := &sigRegistry{payload: payloadFor(digest), cert: true}
	reg.sig = sign(t, k, reg.payload)
	srv := reg.serve(t)
	res := (&Checker{Scheme: "http"}).CheckWith(context.Background(), sigRef(srv), Options{})
	if res.Status != StatusSigned || res.Verification != VerifiedKeyless {
		t.Errorf("got %+v", res)
	}
}

func TestNoPolicyKeyLeavesItUnverified(t *testing.T) {
	k, _ := newKey(t)
	reg := &sigRegistry{payload: payloadFor(digest)}
	reg.sig = sign(t, k, reg.payload)
	srv := reg.serve(t)
	res := (&Checker{Scheme: "http"}).CheckWith(context.Background(), sigRef(srv), Options{})
	if res.Status != StatusSigned || res.Verification != VerifiedNoKey {
		t.Errorf("got %+v", res)
	}
}

func TestPullSecretCredentialsReachAPrivateRegistry(t *testing.T) {
	k, pub := newKey(t)
	reg := &sigRegistry{payload: payloadFor(digest), needsBasic: "robot:s3cret"}
	reg.sig = sign(t, k, reg.payload)
	srv := reg.serve(t)
	ref := sigRef(srv)
	c := &Checker{Scheme: "http"}
	if res := c.CheckWith(context.Background(), ref, Options{Keys: mustKeys(t, "p", pub)}); res.Status != StatusUnknown {
		t.Fatalf("anonymous against a private registry: %+v", res)
	}
	res := c.CheckWith(context.Background(), ref, Options{Keys: mustKeys(t, "p", pub), Creds: &Credentials{Username: "robot", Password: "s3cret"}})
	if res.Status != StatusSigned || res.Verification != VerifiedOK {
		t.Errorf("with the pod's pull secret: %+v", res)
	}
}

func TestParsePublicKeysReadsSeveralPEMsAndRejectsJunk(t *testing.T) {
	_, a := newKey(t)
	_, b := newKey(t)
	keys, err := ParsePublicKeys(a+"\n"+b, "src", []string{"ghcr.io/acme/*"})
	if err != nil || len(keys) != 2 || keys[0].Source != "src" || keys[0].Images[0] != "ghcr.io/acme/*" {
		t.Fatalf("keys=%+v err=%v", keys, err)
	}
	if _, err := ParsePublicKeys("not a key", "src", nil); err == nil {
		t.Error("junk must be an error")
	}
	if !keys[0].AppliesTo("ghcr.io/acme/api:1.2") || keys[0].AppliesTo("docker.io/library/nginx:1") {
		t.Error("image patterns decide which keys are tried")
	}
	if all, _ := ParsePublicKeys(a, "src", nil); !all[0].AppliesTo("anything/at:all") {
		t.Error("a key with no pattern applies to every image")
	}
}
