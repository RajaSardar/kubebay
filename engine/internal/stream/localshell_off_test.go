//go:build !localshell

package stream

import "testing"

// Without the tag the kind must be rejected outright — a binary that merely
// refused at startup would still contain the code path.
func TestLocalShellKindRejectedWithoutTag(t *testing.T) {
	if validChanKind(ChanKindLocalShell) {
		t.Fatal("local-shell accepted in a build without the localshell tag")
	}
	if !validChanKind(ChanKindExec) || !validChanKind(ChanKindLogs) {
		t.Fatal("exec/logs must stay valid")
	}
}
