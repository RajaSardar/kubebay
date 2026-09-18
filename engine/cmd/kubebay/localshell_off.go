//go:build !localshell

package main

import (
	"log/slog"

	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/localshell"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func setupLocalShell(log *slog.Logger, ch *httpapi.Channels, enabled, _, _ bool, _ string) (stream.ChannelDeps, func()) {
	if enabled {
		log.Error("--local-shell ignored", "err", localshell.ErrNotBuilt)
	}
	return ch, func() {}
}
