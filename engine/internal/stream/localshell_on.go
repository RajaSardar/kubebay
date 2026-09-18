//go:build localshell

package stream

import (
	"context"
	"io"
)

const localShellBuilt = true

// LocalShellDeps is satisfied by a ChannelDeps implementation that can open a
// PTY on the machine running the engine.  It is kept separate from ChannelDeps
// so a build without the localshell tag holds no reference to it at all.
type LocalShellDeps interface {
	OpenLocalShell(ctx context.Context, spec ChanSpec, write func([]byte) error, stdin io.Reader, resize <-chan TermSize) error
}

func (h *Hub) runLocalShell(ctx context.Context, frame *ClientFrame, writer *connWriter, stdin *io.PipeReader, resize chan TermSize, finished func()) {
	defer finished()
	defer stdin.Close()
	// frame.Command is deliberately NOT carried into the spec.  The client picks
	// the terminal, never the program: the engine resolves the shell itself, so
	// the build tag gates "a shell" rather than "arbitrary exec on the user's box".
	spec := ChanSpec{Kind: ChanKindLocalShell, Cluster: frame.Cluster, Cols: frame.Cols, Rows: frame.Rows}
	write := func(b []byte) error {
		return writer.sendData(&DataFrame{Type: TypeChanData, ID: frame.ID, Data: b})
	}
	msg := "done"
	if deps, ok := h.chandeps.(LocalShellDeps); !ok {
		msg = "local shell is not enabled"
	} else if err := deps.OpenLocalShell(ctx, spec, write, stdin, resize); err != nil {
		msg = err.Error()
	}
	_ = writer.sendControl(ControlFrame{Type: TypeChanClosed, ID: frame.ID, Message: msg})
}
