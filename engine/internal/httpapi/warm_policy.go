package httpapi

import (
	"fmt"
	"net/http"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// WarmSettings is the user's warm-cluster policy (backlog 37): how many
// connected clusters keep live streams, and how long an unviewed one stays
// warm. It overrides the --warm-clusters and --warm-idle flags once saved.
type WarmSettings struct {
	// Clusters is the cap; 0 = no limit.
	Clusters int `json:"clusters"`
	// IdleMinutes is the idle limit; 0 = never.
	IdleMinutes int `json:"idleMinutes"`
}

const (
	maxWarmClusters = 50
	maxWarmIdleMin  = 24 * 60
)

// WarmPolicyBlockReason is why the warm policy cannot be set here, or "".
// Streams are shared between users with OIDC or in-cluster, so one person's
// idle clock must not cut another's: the engine never evicts there.
func WarmPolicyBlockReason(inCluster, oidcEnabled bool) string {
	switch {
	case oidcEnabled:
		return "Not available when OIDC or an auth proxy is configured: streams are shared between users, so the engine keeps every cluster streaming."
	case inCluster:
		return "Not available when Kubebay runs in a cluster: streams are shared between users, so the engine keeps every cluster streaming."
	}
	return ""
}

// ApplyStoredWarmPolicy applies a saved warm policy over the flag defaults.
// A no-op when none is saved or the deployment cannot evict.
func (s *SettingsManager) ApplyStoredWarmPolicy() {
	if s.WarmPolicyDisabled != "" {
		return
	}
	set, err := s.Load()
	if err != nil || set.Warm == nil {
		return
	}
	s.mgr.SetWarmPolicy(set.Warm.Clusters, time.Duration(set.Warm.IdleMinutes)*time.Minute)
}

// HandleWarmGet reports the policy in force, the defaults and whether it can be set.
func (s *SettingsManager) HandleWarmGet(w http.ResponseWriter, _ *http.Request) {
	c, idle := s.mgr.WarmPolicy()
	writeJSON(w, map[string]any{
		"available":          s.WarmPolicyDisabled == "",
		"reason":             s.WarmPolicyDisabled,
		"clusters":           c,
		"idleMinutes":        int(idle / time.Minute),
		"defaultClusters":    clusters.DefaultWarmCap,
		"defaultIdleMinutes": int(clusters.DefaultIdleAfter / time.Minute),
	})
}

// HandleWarmSave stores the policy and applies it to the running engine.
func (s *SettingsManager) HandleWarmSave(w http.ResponseWriter, r *http.Request) {
	if s.WarmPolicyDisabled != "" {
		http.Error(w, s.WarmPolicyDisabled, http.StatusForbidden)
		return
	}
	var in WarmSettings
	if err := decodeBody(r, &in); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if in.Clusters < 0 || in.Clusters > maxWarmClusters {
		http.Error(w, fmt.Sprintf("clusters must be 0 to %d", maxWarmClusters), http.StatusBadRequest)
		return
	}
	if in.IdleMinutes < 0 || in.IdleMinutes > maxWarmIdleMin {
		http.Error(w, fmt.Sprintf("idleMinutes must be 0 to %d", maxWarmIdleMin), http.StatusBadRequest)
		return
	}
	s.mu <- struct{}{}
	set, err := s.Load()
	if err == nil {
		set.Warm = &in
		err = s.save(set)
	}
	<-s.mu
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mgr.SetWarmPolicy(in.Clusters, time.Duration(in.IdleMinutes)*time.Minute)
	s.HandleWarmGet(w, r)
}
