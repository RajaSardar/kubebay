//go:build !localshell

package stream

import (
	"context"
	"io"
)

const localShellBuilt = false

// runLocalShell is unreachable here: validChanKind rejects ChanKindLocalShell
// when localShellBuilt is false.  It exists only so hub.go compiles without the
// feature, and it links no PTY code into the shipped binary.
func (h *Hub) runLocalShell(_ context.Context, frame *ClientFrame, writer *connWriter, stdin *io.PipeReader, _ chan TermSize, finished func()) {
	defer finished()
	defer stdin.Close()
	_ = writer.sendControl(ControlFrame{Type: TypeChanClosed, ID: frame.ID, Message: "local shell is not built into this binary"})
}
