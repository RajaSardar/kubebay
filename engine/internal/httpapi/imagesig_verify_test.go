package httpapi

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
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
