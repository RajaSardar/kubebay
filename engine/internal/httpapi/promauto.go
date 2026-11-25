package httpapi

import (
	"context"
	"net/http"
	"net/url"
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
	return s.discovery().GetReport(ctx, promIdentityKey(ctx, cluster), func(lctx context.Context) (prometheus.Result, error) {
		cs, err := kubernetes.NewForConfig(cfg)
		if err != nil {
			return prometheus.Result{}, err
		}
		return prometheus.DiscoverReport(lctx, cs)
	}, refresh)
}

// promDirect is the Prometheus URL to query as itself, if any. fallback marks
// the legacy default URL that applies to every cluster without its own: a
// port-forward to one cluster must not hide a Prometheus found in another, so
// the default only serves when nothing is detected. A shared engine, or a
// signed-in OIDC user, keeps the exact rules of directPromURLForRequest.
func (s *SettingsManager) promDirect(ctx context.Context, set *AppSettings, cluster string) (u string, fallback bool) {
	if id := clusters.IdentityFromContext(ctx); s.SharedLocked != "" || (id != nil && id.Name != "") {
		return s.directPromURLForRequest(ctx, set, cluster), false
	}
	if u := set.PrometheusURLs[cluster]; u != "" {
		return u, false
	}
	// The operator's URL is deployment configuration: it outranks both the
	// stored default and anything detected.
	if u := normalizePromURL(s.Operator.PrometheusURL); u != "" {
		return u, false
	}
	return set.PrometheusURL, set.PrometheusURL != ""
}

// promPlan is where a cluster's queries go and why.
type promPlan struct {
	source string // "manual", "default", "auto" or "none"
	base   string
	client *http.Client // nil for a direct URL: the caller uses the SSRF-guarded client
	cand   *prometheus.Candidate
}

// promPlanFor resolves, in order: a URL for this cluster (or the operator's),
// the pinned or best discovered Service reached through the API server's
// service proxy with the caller's identity, then the default URL.
func (s *SettingsManager) promPlanFor(ctx context.Context, set *AppSettings, cluster string) promPlan {
	u, fallback := s.promDirect(ctx, set, cluster)
	if u != "" && !fallback {
		return promPlan{source: "manual", base: u}
	}
	if s.mgr != nil {
		if c, ok := s.autoTarget(ctx, set, cluster); ok {
			if base, client, err := s.proxyBase(ctx, cluster, c); err == nil {
				return promPlan{source: "auto", base: base, client: client, cand: &c}
			}
		}
	}
	if u != "" {
		return promPlan{source: "default", base: u}
	}
	return promPlan{source: "none"}
}

// promBase resolves where to send a query for a cluster. "" means none.
func (s *SettingsManager) promBase(ctx context.Context, set *AppSettings, cluster string) (string, *http.Client) {
	p := s.promPlanFor(ctx, set, cluster)
	return p.base, p.client
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
	// What discovery looked at, for "not found" to say why.
	Scope      string   `json:"scope,omitempty"`
	Tried      []string `json:"tried,omitempty"`
	Forbidden  []string `json:"forbidden,omitempty"`
	Error      string   `json:"error,omitempty"`
	DefaultURL string   `json:"defaultUrl,omitempty"`
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
	if u, fallback := s.promDirect(r.Context(), set, cluster); u != "" && !fallback {
		out.Source, out.Target = "manual", redactURL(u)
		writeJSON(w, out)
		return
	}
	res := s.discover(r.Context(), cluster, r.URL.Query().Get("refresh") != "")
	if res.Candidates != nil {
		out.Candidates = res.Candidates
	}
	out.Scope, out.Tried, out.Forbidden, out.Error = res.Scope, res.Tried, res.Forbidden, res.Err
	if t := s.promTargetsInForce(set)[cluster]; t != "" {
		if c, err := prometheus.ParseTarget(t); err == nil {
			out.Source, out.Target, out.Chosen = "auto", c.Target(), true
		}
	}
	if out.Source == "none" && len(res.Candidates) > 0 {
		out.Source, out.Target = "auto", res.Candidates[0].Target()
	}
	if u, fallback := s.promDirect(r.Context(), set, cluster); u != "" && fallback {
		out.DefaultURL = redactURL(u)
		if out.Source == "none" {
			out.Source, out.Target = "default", redactURL(u)
		}
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

// redactURL hides a password embedded in a URL, for anything shown on screen.
func redactURL(raw string) string {
	if u, err := url.Parse(raw); err == nil {
		return u.Redacted()
	}
	return raw
}
