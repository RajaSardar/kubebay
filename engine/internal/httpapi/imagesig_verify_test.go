package httpapi

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/RajaSardar/kubebay/engine/internal/sigcheck"
)

func pemKey(t *testing.T) string {
	t.Helper()
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(&k.PublicKey)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}

func TestPolicyKeysFromKyvernoAndSigstore(t *testing.T) {
	kyverno := &unstructured.Unstructured{Object: map[string]any{
		"kind": "ClusterPolicy", "metadata": map[string]any{"name": "verify-acme"},
		"spec": map[string]any{"rules": []any{map[string]any{"verifyImages": []any{map[string]any{
			"imageReferences": []any{"ghcr.io/acme/*"},
			"attestors":       []any{map[string]any{"entries": []any{map[string]any{"keys": map[string]any{"publicKeys": pemKey(t)}}}}},
		}}}}},
	}}
	sigstore := &unstructured.Unstructured{Object: map[string]any{
		"kind": "ClusterImagePolicy", "metadata": map[string]any{"name": "acme"},
		"spec": map[string]any{
			"images":      []any{map[string]any{"glob": "registry.acme.io/**"}},
			"authorities": []any{map[string]any{"key": map[string]any{"data": pemKey(t)}}, map[string]any{"keyless": map[string]any{}}},
		},
	}}
	keys := policyKeys([]*unstructured.Unstructured{kyverno, sigstore})
	if len(keys) != 2 {
		t.Fatalf("keys = %+v", keys)
	}
	if keys[0].Source != "Kyverno ClusterPolicy verify-acme" || keys[0].Images[0] != "ghcr.io/acme/*" {
		t.Errorf("kyverno key = %+v", keys[0])
	}
	if keys[1].Source != "Sigstore ClusterImagePolicy acme" || !keys[1].AppliesTo("registry.acme.io/team/api:1") {
		t.Errorf("sigstore key = %+v", keys[1])
	}
}

func TestPullCredentialsFromDockerConfig(t *testing.T) {
	b64 := func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
	sec := corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: "regcred"},
		Type:       corev1.SecretTypeDockerConfigJson,
		Data: map[string][]byte{corev1.DockerConfigJsonKey: []byte(`{"auths":{
			"https://index.docker.io/v1/":{"auth":"` + b64("hubuser:hubpass") + `"},
			"ghcr.io":{"username":"bot","password":"ghp_x"},
			"https://registry.acme.io:5000/v2/":{"auth":"` + b64("a:b") + `"}}}`)},
	}
	opaque := corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: "shop", Name: "other"}, Type: corev1.SecretTypeOpaque, Data: map[string][]byte{"x": []byte("y")}}
	got := pullCredentials([]corev1.Secret{sec, opaque})
	for reg, want := range map[string]string{"registry-1.docker.io": "hubuser:hubpass", "ghcr.io": "bot:ghp_x", "registry.acme.io:5000": "a:b"} {
		c, ok := got[reg]
		if !ok || c.Username+":"+c.Password != want {
			t.Errorf("%s = %+v", reg, c)
		}
	}
	if len(got) != 3 {
		t.Errorf("only dockerconfigjson secrets count: %v", got)
	}
}

func TestImageSignatureReportPassesThePodsPullCredentials(t *testing.T) {
	pods := []corev1.Pod{sigPod("shop", "web-1", "ghcr.io/org/web:1", "ghcr.io/org/web@"+sigDigest)}
	var gotCreds *sigcheck.Credentials
	var gotImage string
	check := func(_ context.Context, _ sigcheck.Ref, image string, creds *sigcheck.Credentials) sigcheck.Result {
		gotCreds, gotImage = creds, image
		return sigcheck.Result{Status: sigcheck.StatusSigned}
	}
	credsFor := func(p corev1.Pod, registry string) *sigcheck.Credentials {
		if p.Name == "web-1" && registry == "ghcr.io" {
			return &sigcheck.Credentials{Username: "bot", Password: "x"}
		}
		return nil
	}
	imageSignatureReport(context.Background(), pods, check, credsFor, 10)
	if gotCreds == nil || gotCreds.Username != "bot" || gotImage != "ghcr.io/org/web:1" {
		t.Errorf("creds=%+v image=%q", gotCreds, gotImage)
	}
}

func TestPolicyIdentitiesFromKyvernoAndSigstore(t *testing.T) {
	kyverno := &unstructured.Unstructured{Object: map[string]any{
		"kind": "ClusterPolicy", "metadata": map[string]any{"name": "verify-acme"},
		"spec": map[string]any{"rules": []any{map[string]any{"verifyImages": []any{
			map[string]any{
				"imageReferences": []any{"ghcr.io/acme/*"},
				"attestors": []any{map[string]any{"entries": []any{
					map[string]any{"keyless": map[string]any{"subject": "https://github.com/acme/*", "issuer": "https://token.actions.githubusercontent.com", "rekor": map[string]any{"url": "https://rekor.sigstore.dev"}}},
					map[string]any{"keyless": map[string]any{"subjectRegExp": ".*@acme.dev", "roots": "-----BEGIN CERTIFICATE-----"}},
					map[string]any{"keyless": map[string]any{"subject": "x", "rekor": map[string]any{"url": "https://rekor.internal.acme"}}},
				}}},
			},
			// The older form: subject and issuer on the entry itself.
			map[string]any{"image": "ghcr.io/old/*", "subject": "old@acme.dev", "issuer": "https://accounts.google.com"},
		}}}},
	}}
	sigstore := &unstructured.Unstructured{Object: map[string]any{
		"kind": "ClusterImagePolicy", "metadata": map[string]any{"name": "acme"},
		"spec": map[string]any{
			"images": []any{map[string]any{"glob": "registry.acme.io/**"}},
			"authorities": []any{
				map[string]any{"keyless": map[string]any{"url": "https://fulcio.sigstore.dev", "identities": []any{
					map[string]any{"issuer": "https://accounts.google.com", "subject": "release@acme.dev"},
					map[string]any{"issuerRegExp": ".*", "subjectRegExp": ".*@acme.dev"},
				}}},
				map[string]any{"keyless": map[string]any{"url": "https://fulcio.internal.acme", "identities": []any{map[string]any{"issuer": "i", "subject": "s"}}}},
				map[string]any{"keyless": map[string]any{"trustRootRef": "private", "identities": []any{map[string]any{"issuer": "i", "subject": "s"}}}},
				map[string]any{"key": map[string]any{"data": pemKey(t)}},
			},
		},
	}}
	ids := policyIdentities([]*unstructured.Unstructured{kyverno, sigstore})
	if len(ids) != 8 {
		t.Fatalf("identities = %+v", ids)
	}
	k := ids[0]
	if k.Source != "Kyverno ClusterPolicy verify-acme" || k.Images[0] != "ghcr.io/acme/*" || k.Subject != "https://github.com/acme/*" || !k.Wildcards || k.Unsupported != "" {
		t.Errorf("kyverno = %+v", k)
	}
	if ids[1].Unsupported == "" || !strings.Contains(ids[1].Unsupported, "Fulcio") || ids[2].Unsupported == "" || !strings.Contains(ids[2].Unsupported, "Rekor") {
		t.Errorf("own roots: %+v / %+v", ids[1], ids[2])
	}
	if ids[3].Subject != "old@acme.dev" || ids[3].Images[0] != "ghcr.io/old/*" {
		t.Errorf("older form = %+v", ids[3])
	}
	s := ids[4]
	if s.Source != "Sigstore ClusterImagePolicy acme" || s.Subject != "release@acme.dev" || s.Wildcards || !s.AppliesTo("registry.acme.io/team/api") || s.Unsupported != "" {
		t.Errorf("sigstore = %+v", s)
	}
	if ids[5].SubjectRegExp != ".*@acme.dev" || ids[6].Unsupported == "" || ids[7].Unsupported == "" {
		t.Errorf("sigstore rest = %+v %+v %+v", ids[5], ids[6], ids[7])
	}
}

func TestImageSignatureReportNamesTheKeylessSigner(t *testing.T) {
	pods := []corev1.Pod{sigPod("shop", "web-1", "ghcr.io/org/web:1", "ghcr.io/org/web@"+sigDigest)}
	check := func(context.Context, sigcheck.Ref, string, *sigcheck.Credentials) sigcheck.Result {
		return sigcheck.Result{Status: sigcheck.StatusSigned, Verification: sigcheck.VerifiedOK, VerifiedBy: "Kyverno ClusterPolicy p", Signer: "release@acme.dev", Issuer: "https://accounts.google.com"}
	}
	rows := imageSignatureReport(context.Background(), pods, check, nil, 10)
	if len(rows) != 1 || rows[0].Signer != "release@acme.dev" || rows[0].Issuer != "https://accounts.google.com" {
		t.Errorf("rows = %+v", rows)
	}
}
