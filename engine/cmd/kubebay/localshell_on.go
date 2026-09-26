//go:build localshell

package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os/exec"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/httpapi"
	"github.com/RajaSardar/kubebay/engine/internal/localshell"
	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

func setupLocalShell(log *slog.Logger, ch *httpapi.Channels, enabled, inCluster, oidcEnabled bool, addr string) (stream.ChannelDeps, httpapi.LocalShellStatus, func()) {
	noop := func() {}
	st := httpapi.LocalShellStatus{Enabled: enabled}
	if err := localshell.Allowed(enabled, inCluster, oidcEnabled, addr); err != nil {
		if enabled {
			log.Error("--local-shell refused", "err", err)
		}
		st.Reason = err.Error()
		return ch, st, noop
	}
	m, err := localshell.NewManager(log)
	if err != nil {
		log.Error("--local-shell unavailable", "err", err)
		st.Reason = err.Error()
		return ch, st, noop
	}
	log.Warn("local shell ENABLED — anything that can reach this listener with the token can run commands as you")
	st.Available = true
	st.Kubectl = probeKubectl()
	return httpapi.WithLocalShell(ch, m), st, func() { _ = m.Close() }
}

// probeKubectl runs once at startup so the terminal can say "kubectl is not on
// PATH" before the user types it.  Kubebay never installs anything: a missing
// kubectl is reported, not fixed.
func probeKubectl() *httpapi.KubectlStatus {
	path, err := exec.LookPath("kubectl")
	if err != nil {
		return &httpapi.KubectlStatus{}
	}
	st := &httpapi.KubectlStatus{Found: true}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "version", "--client=true", "--output=json").Output()
	if err != nil {
		return st
	}
	var v struct {
		ClientVersion struct {
			GitVersion string `json:"gitVersion"`
		} `json:"clientVersion"`
	}
	if json.Unmarshal(out, &v) == nil {
		st.Version = v.ClientVersion.GitVersion
	}
	return st
}
