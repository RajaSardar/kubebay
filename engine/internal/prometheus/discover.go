// Package prometheus finds a Prometheus Service inside a cluster the way Lens
// does, so metrics work without a hand-typed URL. Queries then go through the
// Kubernetes API server's service proxy using the caller's own credentials.
package prometheus

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// Candidate is one Service that looks like a Prometheus (or Thanos query).
type Candidate struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Port      int32  `json:"port"`
	Scheme    string `json:"scheme"` // "http" or "https"
	Score     int    `json:"score"`
	TargetStr string `json:"target"`
}

// Target is the compact "ns/name:port" form (prefixed "https:" for TLS).
func (c Candidate) Target() string {
	s := fmt.Sprintf("%s/%s:%d", c.Namespace, c.Name, c.Port)
	if c.Scheme == "https" {
		return "https:" + s
	}
	return s
}

// ProxyPath is the API-server path that fronts the Service:
// /api/v1/namespaces/<ns>/services/[<scheme>:]<name>:<port>/proxy
func (c Candidate) ProxyPath() string {
	name := fmt.Sprintf("%s:%d", c.Name, c.Port)
	if c.Scheme == "https" {
		name = "https:" + name
	}
	return "/api/v1/namespaces/" + c.Namespace + "/services/" + name + "/proxy" + queryPrefix(c.Name)
}

// queryPrefix is where a backend serves the Prometheus HTTP API when it is not
// at the root: VictoriaMetrics' cluster read path and Mimir/Cortex's /prometheus.
func queryPrefix(name string) string {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "vmselect"):
		return "/select/0/prometheus"
	case (strings.HasPrefix(n, "mimir") || strings.HasPrefix(n, "cortex")) && strings.Contains(n, "query-frontend"):
		return "/prometheus"
	}
	return ""
}

// ParseTarget is the inverse of Target.
// k8sName is a Kubernetes namespace or Service name. Anything else (a "?", "#",
// "%" or space) would change which API-server path the proxied request hits.
var k8sName = regexp.MustCompile(`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`)

func ParseTarget(s string) (Candidate, error) {
	c := Candidate{Scheme: "http"}
	rest := strings.TrimSpace(s)
	if strings.HasPrefix(rest, "https:") {
		c.Scheme = "https"
		rest = strings.TrimPrefix(rest, "https:")
	}
	slash := strings.Index(rest, "/")
	colon := strings.LastIndex(rest, ":")
	if slash <= 0 || colon <= slash+1 || colon == len(rest)-1 {
		return Candidate{}, fmt.Errorf("target %q must look like namespace/service:port", s)
	}
	c.Namespace, c.Name = rest[:slash], rest[slash+1:colon]
	if strings.Contains(c.Name, "/") || !k8sName.MatchString(c.Namespace) || !k8sName.MatchString(c.Name) {
		return Candidate{}, fmt.Errorf("target %q must look like namespace/service:port", s)
	}
	p, err := strconv.Atoi(rest[colon+1:])
	if err != nil || p < 1 || p > 65535 {
		return Candidate{}, fmt.Errorf("target %q has an invalid port", s)
	}
	c.Port = int32(p)
	c.TargetStr = c.Target()
	return c, nil
}

// Services that are part of a monitoring stack but are not a query endpoint.
var noise = []string{
	"alertmanager", "node-exporter", "pushgateway", "kube-state-metrics", "grafana",
	"operator", "blackbox", "adapter", "-exporter", "config-reloader", "thanos-sidecar",
	"thanos-store", "thanos-compact", "thanos-ruler", "thanos-receive", "loki", "tempo",
}

var knownNames = map[string]int{
	"kube-prometheus-stack-prometheus":      100,
	"prometheus-kube-prometheus-prometheus": 100,
	"prometheus-k8s":                        100,
	"prometheus-server":                     95,
	"prometheus":                            90,
	"thanos-query":                          60,
	"thanos-query-frontend":                 55,
	"prometheus-operated":                   40,
	"vmsingle":                              60,
	"victoria-metrics-single-server":        60,
}

// backendScore recognises query endpoints whose names carry a release prefix.
func backendScore(s *corev1.Service) int {
	n := strings.ToLower(s.Name)
	switch {
	case strings.Contains(n, "vmselect"), strings.Contains(n, "vmsingle"):
		return 60
	case (strings.HasPrefix(n, "mimir") || strings.HasPrefix(n, "cortex")) && strings.Contains(n, "query-frontend"):
		return 55
	case s.Namespace == "gmp-system" && n == "frontend":
		return 50
	}
	switch s.Labels["app.kubernetes.io/name"] {
	case "vmsingle", "vmselect":
		return 60
	}
	return 0
}

var goodNamespaces = map[string]bool{
	"monitoring": true, "prometheus": true, "observability": true, "lens-metrics": true,
	"kube-prometheus": true, "openshift-monitoring": true, "kube-system": true,
	"victoria-metrics": true, "mimir": true, "gmp-system": true, "cattle-monitoring-system": true,
}

var preferredPorts = []string{"web", "http-web", "http", "prometheus", "http-prometheus", "web-http", "https", "https-web"}

func isNoise(s *corev1.Service) bool {
	hay := []string{strings.ToLower(s.Name)}
	for _, k := range []string{"app", "app.kubernetes.io/name", "app.kubernetes.io/component", "component"} {
		hay = append(hay, strings.ToLower(s.Labels[k]))
	}
	for _, h := range hay {
		for _, n := range noise {
			if strings.Contains(h, n) {
				return true
			}
		}
	}
	return false
}

func labelScore(l map[string]string) int {
	best := 0
	set := func(v int) {
		if v > best {
			best = v
		}
	}
	switch l["app.kubernetes.io/name"] {
	case "prometheus":
		set(80)
	case "kube-prometheus-stack-prometheus":
		set(85)
	}
	switch l["app"] {
	case "prometheus":
		set(75)
	case "kube-prometheus-stack-prometheus":
		set(85)
	}
	if l["app.kubernetes.io/name"] == "thanos-query" {
		set(60)
	}
	return best
}

func pickPort(ports []corev1.ServicePort) (corev1.ServicePort, int, bool) {
	if len(ports) == 0 {
		return corev1.ServicePort{}, 0, false
	}
	for i, want := range preferredPorts {
		for _, p := range ports {
			if strings.EqualFold(p.Name, want) {
				return p, 10 - i, true
			}
		}
	}
	for _, p := range ports {
		if p.Port == 9090 {
			return p, 5, true
		}
	}
	for _, p := range ports {
		if p.Port == 80 {
			return p, 2, true
		}
	}
	return ports[0], 0, true
}

// Rank turns a Service list into Prometheus candidates, best first.
func Rank(services []corev1.Service) []Candidate {
	var out []Candidate
	for i := range services {
		s := &services[i]
		if s.Spec.Type == corev1.ServiceTypeExternalName || isNoise(s) {
			continue
		}
		score := knownNames[s.Name]
		if ls := labelScore(s.Labels); ls > score {
			score = ls
		}
		if bs := backendScore(s); bs > score {
			score = bs
		}
		if score == 0 && strings.Contains(s.Name, "prometheus") {
			score = 30
		}
		if score == 0 {
			continue
		}
		p, bonus, ok := pickPort(s.Spec.Ports)
		if !ok {
			continue
		}
		if goodNamespaces[s.Namespace] {
			bonus += 5
		}
		c := Candidate{Namespace: s.Namespace, Name: s.Name, Port: p.Port, Scheme: "http", Score: score*100 + bonus}
		if strings.HasPrefix(strings.ToLower(p.Name), "https") {
			c.Scheme = "https"
		}
		c.TargetStr = c.Target()
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Target() < out[j].Target()
	})
	return out
}

var wellKnownNamespaces = []string{"monitoring", "prometheus", "observability", "lens-metrics", "kube-prometheus", "openshift-monitoring", "kube-system", "default",
	"victoria-metrics", "mimir", "gmp-system", "cattle-monitoring-system", "monitoring-system", "kubesphere-monitoring-system"}

// Discover lists Services across the cluster and ranks them. See DiscoverReport.
func Discover(ctx context.Context, cs kubernetes.Interface) ([]Candidate, error) {
	res, err := DiscoverReport(ctx, cs)
	return res.Candidates, err
}

// DiscoverReport is Discover that also says how far it looked: Scope is
// "cluster" when every Service could be listed, "namespaces" when the identity
// could only list the usual monitoring namespaces (Tried), and Forbidden holds
// the ones it was refused. An error means nothing could be listed at all; no
// match is an empty result and nil.
func DiscoverReport(ctx context.Context, cs kubernetes.Interface) (Result, error) {
	list, err := cs.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err == nil {
		return Result{Candidates: Rank(list.Items), Scope: "cluster"}, nil
	}
	if !apierrors.IsForbidden(err) && !apierrors.IsUnauthorized(err) {
		return Result{}, err
	}
	res := Result{Scope: "namespaces"}
	var all []corev1.Service
	var firstErr error
	listed := false
	for _, ns := range wellKnownNamespaces {
		res.Tried = append(res.Tried, ns)
		l, e := cs.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
		if e != nil {
			if apierrors.IsForbidden(e) || apierrors.IsUnauthorized(e) {
				res.Forbidden = append(res.Forbidden, ns)
			}
			if firstErr == nil {
				firstErr = e
			}
			continue
		}
		listed = true
		all = append(all, l.Items...)
	}
	if !listed {
		if firstErr == nil {
			firstErr = errors.New("no namespace could be listed")
		}
		return res, firstErr
	}
	res.Candidates = Rank(all)
	return res, nil
}

// Result is one cached discovery outcome. Err is informational only.
type Result struct {
	Candidates []Candidate
	Err        string
	// Scope is "cluster" or "namespaces"; Tried and Forbidden name the
	// namespaces looked at and refused when only some could be listed.
	Scope     string
	Tried     []string
	Forbidden []string
}

type entry struct {
	res     Result
	at      time.Time
	ok      bool
	loading chan struct{}
}

// Cache remembers discovery per key so page loads never repeat the Service list.
type Cache struct {
	ttl, negTTL time.Duration
	now         func() time.Time
	mu          sync.Mutex
	m           map[string]*entry
}

// NewCache: ttl for a successful lookup, negTTL for a failed one.
func NewCache(ttl, negTTL time.Duration) *Cache {
	return &Cache{ttl: ttl, negTTL: negTTL, now: time.Now, m: map[string]*entry{}}
}

// Get returns the cached result, loading it when missing, expired or refresh is
// set. Concurrent callers share one load. The load is detached from ctx so one
// cancelled request does not poison the cache for the next.
func (c *Cache) Get(ctx context.Context, key string, load func(context.Context) ([]Candidate, error), refresh bool) Result {
	return c.GetReport(ctx, key, func(lctx context.Context) (Result, error) {
		cands, err := load(lctx)
		return Result{Candidates: cands}, err
	}, refresh)
}

// GetReport is Get for a loader that returns the whole Result.
func (c *Cache) GetReport(ctx context.Context, key string, load func(context.Context) (Result, error), refresh bool) Result {
	for {
		c.mu.Lock()
		e := c.m[key]
		if e == nil {
			e = &entry{}
			c.m[key] = e
		}
		if e.loading != nil {
			ch := e.loading
			c.mu.Unlock()
			select {
			case <-ch:
				refresh = false
				continue
			case <-ctx.Done():
				return Result{Err: ctx.Err().Error()}
			}
		}
		if e.ok && !refresh {
			ttl := c.ttl
			if e.res.Err != "" || len(e.res.Candidates) == 0 {
				ttl = c.negTTL
			}
			if c.now().Sub(e.at) < ttl {
				r := e.res
				c.mu.Unlock()
				return r
			}
		}
		e.loading = make(chan struct{})
		ch := e.loading
		c.mu.Unlock()

		lctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		res, err := load(lctx)
		cancel()
		if err != nil {
			res.Err = err.Error()
			if res.Err == "" {
				res.Err = "listing Services failed"
			}
		}
		c.mu.Lock()
		e.res, e.at, e.ok, e.loading = res, c.now(), true, nil
		c.mu.Unlock()
		close(ch)
		return res
	}
}

// Forget drops one key (for example after the user changes the choice).
func (c *Cache) Forget(key string) {
	c.mu.Lock()
	delete(c.m, key)
	c.mu.Unlock()
}
