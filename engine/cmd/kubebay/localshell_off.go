//go:build !localshell

package main

import (
	"log/slog"

	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/localshell"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func setupLocalShell(log *slog.Logger, ch *httpapi.Channels, enabled, _, _ bool, _ string) (stream.ChannelDeps, httpapi.LocalShellStatus, func()) {
	if enabled {
		log.Error("--local-shell ignored", "err", localshell.ErrNotBuilt)
	}
	// Reported rather than hidden: the UI can then say "this build has no local
	// shell" instead of opening a channel just to watch it fail.
	return ch, httpapi.LocalShellStatus{Enabled: enabled, Reason: localshell.ErrNotBuilt.Error()}, func() {}
}
