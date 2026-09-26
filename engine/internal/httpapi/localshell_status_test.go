package httpapi

import (
	"encoding/json"
	"testing"
)

// The web UI branches on these exact field names to decide whether to offer a
// local shell at all, so the JSON shape is part of the contract.
func TestLocalShellStatusJSON(t *testing.T) {
	b, err := json.Marshal(LocalShellStatus{})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(b), `{"available":false,"enabled":false}`; got != want {
		t.Fatalf("zero status = %s, want %s", got, want)
	}

	b, err = json.Marshal(LocalShellStatus{
		Available: true,
		Enabled:   true,
		Kubectl:   &KubectlStatus{Found: true, Version: "v1.31.0"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"available":true,"enabled":true,"kubectl":{"found":true,"version":"v1.31.0"}}`
	if string(b) != want {
		t.Fatalf("status = %s, want %s", b, want)
	}
}
