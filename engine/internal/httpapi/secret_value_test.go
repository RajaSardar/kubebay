package httpapi

import "testing"

func TestDecodeSecretKey(t *testing.T) {
	// "hunter2" base64-encoded, the way every Kubernetes Secret stores its
	// `data` map regardless of how it was created.
	doc := map[string]interface{}{
		"data": map[string]interface{}{
			"password": "aHVudGVyMg==",
		},
	}

	got, err := decodeSecretKey(doc, "password")
	if err != nil {
		t.Fatalf("decodeSecretKey returned error: %v", err)
	}
	if got != "hunter2" {
		t.Errorf("decodeSecretKey = %q, want %q", got, "hunter2")
	}
}

func TestDecodeSecretKeyMissingKey(t *testing.T) {
	doc := map[string]interface{}{"data": map[string]interface{}{"other": "dmFsdWU="}}
	if _, err := decodeSecretKey(doc, "password"); err == nil {
		t.Fatal("expected an error for a missing key, got nil")
	}
}

func TestDecodeSecretKeyMissingDataBlock(t *testing.T) {
	if _, err := decodeSecretKey(map[string]interface{}{}, "password"); err == nil {
		t.Fatal("expected an error when the secret has no data block, got nil")
	}
}

func TestDecodeSecretKeyInvalidBase64(t *testing.T) {
	doc := map[string]interface{}{"data": map[string]interface{}{"password": "not-valid-base64!!!"}}
	if _, err := decodeSecretKey(doc, "password"); err == nil {
		t.Fatal("expected a decode error for invalid base64, got nil")
	}
}

func TestSecretRevealAuditDetail(t *testing.T) {
	detail := secretRevealAuditDetail("db-creds", "password")
	if !containsSubstr(detail, "db-creds") {
		t.Errorf("detail = %q, want it to name the secret", detail)
	}
	if !containsSubstr(detail, "password") {
		t.Errorf("detail = %q, want it to name the key", detail)
	}
}
