//go:build localshell

package httpapi

// localshell.go — WebSocket-to-local-PTY terminal bridge.
//
// Same wire protocol as exec.go, minus one field: a "local-shell" chan-open
// carries no "command".  The engine resolves the shell from its own
// environment, so the client can ask for a terminal but never for a program.
//
//	{"type":"chan-open","kind":"local-shell","id":"t1","cluster":"my-k8s",
//	 "cols":220,"rows":50}
//
// Stdin, resize, close and chan-data frames are identical to exec.

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/localshell"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

// LocalShellChannels decorates Channels with the engine-host PTY channel kind.
// It is a wrapper rather than a field on Channels so that the type carrying
// OpenLocalShell only exists in a build with the tag.
type LocalShellChannels struct {
	*Channels
	Shells *localshell.Manager
}

func WithLocalShell(c *Channels, m *localshell.Manager) *LocalShellChannels {
	return &LocalShellChannels{Channels: c, Shells: m}
}

func (c *LocalShellChannels) OpenLocalShell(
	ctx context.Context,
	spec stream.ChanSpec,
	write func([]byte) error,
	stdin io.Reader,
	resize <-chan stream.TermSize,
) error {
	// Not RestConfig: a misconfigured context has no rest.Config, and debugging
	// exactly that is one of the reasons to want a shell.
	var ctxName string
	if spec.Cluster != "" {
		name, err := c.Clusters.ContextName(spec.Cluster)
		if err != nil {
			return err
		}
		ctxName = name
	}

	shell, err := localshell.ResolveShell()
	if err != nil {
		return err
	}

	c.Audit.Record(audit.Entry{
		Action:  "local-shell",
		Cluster: spec.Cluster,
		Detail:  fmt.Sprintf("event=open context=%s shell=%s", ctxName, shell),
	})

	sizes := make(chan localshell.Size, 16)
	go func() {
		defer close(sizes)
		for {
			select {
			case <-ctx.Done():
				return
			case s, ok := <-resize:
				if !ok {
					return
				}
				select {
				case sizes <- localshell.Size{Cols: s.Cols, Rows: s.Rows}:
				default:
				}
			}
		}
	}()

	out, runErr := c.Shells.Open(ctx, localshell.Options{
		Cluster:         spec.Cluster,
		Context:         ctxName,
		KubeconfigPaths: c.Clusters.ActiveKubeconfigs(),
		Shell:           shell,
		Cols:            spec.Cols,
		Rows:            spec.Rows,
	}, localshell.IO{Write: write, Stdin: stdin, Resize: sizes})

	// Keystrokes are never recorded — only that a shell ran, and how it ended.
	detail := fmt.Sprintf("event=close context=%s shell=%s exit=%d duration=%s",
		out.Context, out.Shell, out.ExitCode, out.Duration.Round(time.Millisecond))
	if runErr != nil {
		detail += " error=" + runErr.Error()
	}
	c.Audit.Record(audit.Entry{Action: "local-shell", Cluster: spec.Cluster, Detail: detail})

	return runErr
}
