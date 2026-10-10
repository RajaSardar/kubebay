package redact

import (
	"strings"
	"testing"
)

func TestSecretsInFreeTextAreRedacted(t *testing.T) {
	for _, tc := range []struct{ name, in, leak string }{
		{"jwt", "auth failed for eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c now", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"},
		{"aws key id", "using AKIAIOSFODNN7EXAMPLE for s3", "AKIAIOSFODNN7EXAMPLE"},
		{"bearer", "GET /v1 Authorization: Bearer abc123def456ghi789", "abc123def456ghi789"},
		{"url credentials", "connecting to postgres://app:s3cr3tpass@db:5432/shop", "s3cr3tpass"},
		{"key=value", "config loaded db_password=hunter2 retries=3", "hunter2"},
		{"key: value", "API_KEY: 9f8e7d6c5b4a", "9f8e7d6c5b4a"},
		{"json", `{"client_secret":"abcd-efgh-ijkl","user":"bob"}`, "abcd-efgh-ijkl"},
		{"anthropic", "key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA rejected", "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA"},
		{"github", "cloning with ghp_0123456789abcdefghijABCDEFGHIJ012345", "ghp_0123456789abcdefghijABCDEFGHIJ012345"},
		{"slack", "posting via xoxb-1234567890-abcdefghij", "xoxb-1234567890-abcdefghij"},
		{"google", "maps key AIzaSyA1234567890abcdefghijklmnopqrstuv", "AIzaSyA1234567890abcdefghijklmnopqrstuv"},
		{"pem", "key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\nok", "MIIEpAIBAAKCAQEA"},
	} {
		out, n := String(tc.in)
		if strings.Contains(out, tc.leak) || n == 0 {
			t.Errorf("%s: %q (n=%d)", tc.name, out, n)
		}
		if !strings.Contains(out, Mask) {
			t.Errorf("%s: no mask in %q", tc.name, out)
		}
	}
}

func TestOrdinaryTextIsLeftAlone(t *testing.T) {
	for _, in := range []string{
		"Back-off restarting failed container api in pod api-7d9-x",
		"token bucket refilled: 10 tokens",
		"password reset email sent to user 42",
		"listening on :8080 (keys=3, secrets=0)",
		"panic: runtime error: invalid memory address or nil pointer dereference",
		"image ghcr.io/acme/api:1.4 pulled in 2.1s",
	} {
		if out, n := String(in); out != in || n != 0 {
			t.Errorf("changed %q to %q (n=%d)", in, out, n)
		}
	}
}

func TestTheNameStaysSoTheReaderKnowsWhatWasThere(t *testing.T) {
	out, _ := String("db_password=hunter2")
	if out != "db_password="+Mask {
		t.Errorf("got %q", out)
	}
	out, _ = String("postgres://app:pw1234@db/shop")
	if out != "postgres://app:"+Mask+"@db/shop" {
		t.Errorf("got %q", out)
	}
}
