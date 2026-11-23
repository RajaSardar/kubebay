package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/prometheus"
)

const (
	promDiscoveryTTL    = 5 * time.Minute
	promDiscoveryNegTTL = 30 * time.Second
)

func (s *SettingsManager) discovery() *prometheus.Cache {
	s.promOnce.Do(func() { s.promCache = prometheus.NewCache(promDiscoveryTTL, promDiscoveryNegTTL) })
	return s.promCache
}

func promIdentityKey(ctx context.Context, cluster string) string {
	who := ""
	if id := clusters.IdentityFromContext(ctx); id != nil {
		who = id.Name
	}
	return cluster + "\x00" + who
}

// discover returns the ranked in-cluster candidates, cached per cluster and
// identity (what a user may list differs). Failure is quiet: no candidates.
func (s *SettingsManager) discover(ctx context.Context, cluster string, refresh bool) prometheus.Result {
	if s.mgr == nil {
		return prometheus.Result{}
	}
	cfg, err := restConfigFor(ctx, s.mgr, cluster)
	if err != nil {
		return prometheus.Result{Err: err.Error()}
	}
	return s.discovery().Get(ctx, promIdentityKey(ctx, cluster), func(lctx context.Context) ([]prometheus.Candidate, error) {
		cs, err := kubernetes.NewForConfig(cfg)
		if err != nil {
			return nil, err
		}
		return prometheus.Discover(lctx, cs)
	}, refresh)
}

// promBase resolves where to send a query for a cluster. A manual URL wins (for
// a signed-in OIDC user only when the operator opened it to everyone) and
// returns a nil client (the caller applies the SSRF-guarded Outbound client).
// Otherwise the pinned or discovered Service is reached through the API
// server's service proxy with the caller's identity. "" means none.
func (s *SettingsManager) promBase(ctx context.Context, set *AppSettings, cluster string) (string, *http.Client) {
	if u := s.directPromURLForRequest(ctx, set, cluster); u != "" {
		return u, nil
	}
	if s.mgr == nil {
		return "", nil
	}
	c, ok := s.autoTarget(ctx, set, cluster)
	if !ok {
		return "", nil
	}
	base, client, err := s.proxyBase(ctx, cluster, c)
	if err != nil {
		return "", nil
	}
	return base, client
}

// autoTarget is the pinned target, else the best discovered candidate.
func (s *SettingsManager) autoTarget(ctx context.Context, set *AppSettings, cluster string) (prometheus.Candidate, bool) {
	if t := s.promTargetsInForce(set)[cluster]; t != "" {
		if c, err := prometheus.ParseTarget(t); err == nil {
			return c, true
		}
	}
	res := s.discover(ctx, cluster, false)
	if len(res.Candidates) == 0 {
		return prometheus.Candidate{}, false
	}
	return res.Candidates[0], true
}

func (s *SettingsManager) proxyBase(ctx context.Context, cluster string, c prometheus.Candidate) (string, *http.Client, error) {
	cfg, err := restConfigFor(ctx, s.mgr, cluster)
	if err != nil {
		return "", nil, err
	}
	client, err := rest.HTTPClientFor(cfg)
	if err != nil {
		return "", nil, err
	}
	client.Timeout = 30 * time.Second
	hostURL, _, err := rest.DefaultServerURL(cfg.Host, "", schema.GroupVersion{}, rest.IsConfigTransportTLS(*cfg))
	if err != nil {
		return "", nil, err
	}
	return strings.TrimRight(hostURL.String(), "/") + c.ProxyPath(), client, nil
}

type promStatusBody struct {
	Source     string                 `json:"source"`
	Target     string                 `json:"target"`
	Chosen     bool                   `json:"chosen"`
	Candidates []prometheus.Candidate `json:"candidates"`
}

// HandlePromStatus (GET /api/prom/status?cluster=&refresh=1) says which
// Prometheus the graphs use: a manual URL, an auto-detected Service, or none.
func (s *SettingsManager) HandlePromStatus(w http.ResponseWriter, r *http.Request) {
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out := promStatusBody{Source: "none", Candidates: []prometheus.Candidate{}}
	if u := s.directPromURLForRequest(r.Context(), set, cluster); u != "" {
		out.Source, out.Target = "manual", u
		writeJSON(w, out)
		return
	}
	res := s.discover(r.Context(), cluster, r.URL.Query().Get("refresh") != "")
	if res.Candidates != nil {
		out.Candidates = res.Candidates
	}
	if t := s.promTargetsInForce(set)[cluster]; t != "" {
		if c, err := prometheus.ParseTarget(t); err == nil {
			out.Source, out.Target, out.Chosen = "auto", c.Target(), true
		}
	}
	if out.Source == "none" && len(res.Candidates) > 0 {
		out.Source, out.Target = "auto", res.Candidates[0].Target()
	}
	writeJSON(w, out)
}

func (s *SettingsManager) setPromTarget(cluster, target string) error {
	s.mu <- struct{}{}
	defer func() { <-s.mu }()
	set, err := s.Load()
	if err != nil {
		return err
	}
	if target == "" {
		delete(set.PrometheusTargets, cluster)
	} else {
		if set.PrometheusTargets == nil {
			set.PrometheusTargets = map[string]string{}
		}
		set.PrometheusTargets[cluster] = target
	}
	return s.save(set)
}

// HandlePromTarget (POST /api/prom/target {cluster, target}) pins one
// auto-detected Service for a cluster; an empty target goes back to auto.
func (s *SettingsManager) HandlePromTarget(w http.ResponseWriter, r *http.Request) {
	if s.refuseIfLocked(w) {
		return
	}
	var body struct {
		Cluster string `json:"cluster"`
		Target  string `json:"target"`
	}
	if err := decodeBody(r, &body); err != nil || body.Cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	target := strings.TrimSpace(body.Target)
	if target != "" {
		c, err := prometheus.ParseTarget(target)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		target = c.Target()
	}
	if err := s.setPromTarget(body.Cluster, target); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
