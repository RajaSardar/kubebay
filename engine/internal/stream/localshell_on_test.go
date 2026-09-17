//go:build localshell

package stream

import "testing"

func TestLocalShellKindAcceptedWithTag(t *testing.T) {
	if !validChanKind(ChanKindLocalShell) {
		t.Fatal("local-shell rejected in a build with the localshell tag")
	}
	if validChanKind("nonsense") {
		t.Fatal("unknown kinds must stay invalid")
	}
}
