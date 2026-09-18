//go:build localshell

package main

import (
	"log/slog"

	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/localshell"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func setupLocalShell(log *slog.Logger, ch *httpapi.Channels, enabled, inCluster, oidcEnabled bool, addr string) (stream.ChannelDeps, func()) {
	noop := func() {}
	if err := localshell.Allowed(enabled, inCluster, oidcEnabled, addr); err != nil {
		if enabled {
			log.Error("--local-shell refused", "err", err)
		}
		return ch, noop
	}
	m, err := localshell.NewManager(log)
	if err != nil {
		log.Error("--local-shell unavailable", "err", err)
		return ch, noop
	}
	log.Warn("local shell ENABLED — anything that can reach this listener with the token can run commands as you")
	return httpapi.WithLocalShell(ch, m), func() { _ = m.Close() }
}
