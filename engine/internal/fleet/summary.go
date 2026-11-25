// Package fleet is the summary tier for many clusters (docs/MANY_CLUSTERS.md
// 6.6): a cheap, cached, on-demand answer to "is anything red" per cluster.
// A summary is one /version call and a paged node LIST. It starts no
// informer, opens no watch and does not connect the cluster, so it never
// counts against the warm-cluster cap.
package fleet

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/version"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

type Status string

const (
	StatusReachable     Status = "reachable"
	StatusUnreachable   Status = "unreachable"
	StatusMisconfigured Status = "misconfigured"
)

const (
	// DefaultTTL is how long a summary is served from the cache.
	DefaultTTL = 60 * time.Second
	// DefaultConcurrency matches the health loop's batch of 10.
	DefaultConcurrency = 10
	// DefaultTimeout is the hard cap on one cluster's summary, exec
	// credential plugin included.
	DefaultTimeout = 12 * time.Second
	// MaxPerRequest bounds one request: the picker asks for what it shows.
	MaxPerRequest = 200
	// nodePageSize and maxNodePages bound the node LIST (5000 nodes).
	nodePageSize = 500
	maxNodePages = 10
)

// Summary is one cluster's fleet-tier facts. Nodes and ReadyNodes are nil
// when they could not be read (unreachable, or nodes forbidden).
type Summary struct {
	ID         string `json:"id"`
	Status     Status `json:"status,omitempty"`
	Version    string `json:"version,omitempty"`
	Nodes      *int   `json:"nodes,omitempty"`
	ReadyNodes *int   `json:"readyNodes,omitempty"`
	// NodesTruncated: the cluster has more nodes than the summary counts.
	NodesTruncated bool       `json:"nodesTruncated,omitempty"`
	Error          string     `json:"error,omitempty"`
	CheckedAt      *time.Time `json:"checkedAt,omitempty"`
	// Pending: a fetch is running; any other fields are the previous result.
	Pending bool `json:"pending,omitempty"`
}

// ConfigFunc returns the client config for a cluster id.
type ConfigFunc func(id string) (*rest.Config, error)

type Options struct {
	TTL         time.Duration
	Concurrency int
	Timeout     time.Duration
	Now         func() time.Time
}

type slot struct {
	sum      Summary
	at       time.Time
	has      bool
	inflight bool
}

// Summarizer caches summaries per (scope, cluster) and fetches stale ones in
// the background, at most Concurrency at a time. Get never blocks on the
// network.
type Summarizer struct {
	ttl     time.Duration
	timeout time.Duration
	now     func() time.Time
	sem     chan struct{}

	mu    sync.Mutex
	slots map[string]*slot
	wg    sync.WaitGroup
}

func New(o Options) *Summarizer {
	if o.TTL <= 0 {
		o.TTL = DefaultTTL
	}
	if o.Concurrency <= 0 {
		o.Concurrency = DefaultConcurrency
	}
	if o.Timeout <= 0 {
		o.Timeout = DefaultTimeout
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return &Summarizer{ttl: o.TTL, timeout: o.Timeout, now: o.Now, sem: make(chan struct{}, o.Concurrency), slots: map[string]*slot{}}
}

// Get returns a summary for each id (deduplicated, at most MaxPerRequest):
// the cached one, and for a missing or stale one it starts a fetch and marks
// it pending. scope keeps identities apart (the OIDC user, "" on desktop). A
// nil cfg only reads the cache.
func (s *Summarizer) Get(scope string, ids []string, cfg ConfigFunc) []Summary {
	now := s.now()
	seen := map[string]bool{}
	out := make([]Summary, 0, min(len(ids), MaxPerRequest))
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		if len(out) == MaxPerRequest {
			break
		}
		seen[id] = true
		key := scope + "\x00" + id
		sl := s.slots[key]
		if sl == nil {
			sl = &slot{}
			s.slots[key] = sl
		}
		if cfg != nil && !sl.inflight && (!sl.has || now.Sub(sl.at) >= s.ttl) {
			s.startLocked(key, id, sl, cfg)
		}
		sum := sl.sum
		sum.ID = id
		sum.Pending = sl.inflight
		out = append(out, sum)
	}
	return out
}

// pruneLocked drops entries nobody has refreshed for ten TTLs, so clusters
// removed from the kubeconfig do not accumulate.
func (s *Summarizer) pruneLocked(now time.Time) {
	for k, sl := range s.slots {
		if sl.has && !sl.inflight && now.Sub(sl.at) > 10*s.ttl {
			delete(s.slots, k)
		}
	}
}

func (s *Summarizer) startLocked(key, id string, sl *slot, cfgFn ConfigFunc) {
	cfg, err := cfgFn(id)
	if err != nil {
		now := s.now()
		sl.sum = Summary{ID: id, Status: StatusMisconfigured, Error: err.Error(), CheckedAt: &now}
		sl.at, sl.has = now, true
		return
	}
	sl.inflight = true
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.sem <- struct{}{}
		released := false
		release := func() {
			if !released {
				released = true
				<-s.sem
			}
		}
		defer release()
		done := make(chan Summary, 1)
		ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
		defer cancel()
		go func() { done <- fetch(ctx, id, cfg, s.timeout) }()
		var sum Summary
		select {
		case sum = <-done:
		case <-time.After(s.timeout + time.Second):
			// A hung exec credential plugin can ignore the context. Free the
			// slot for other clusters but keep this one in flight until its
			// goroutine returns, so it never stacks a second fetch.
			release()
			s.store(key, Summary{ID: id, Status: StatusUnreachable, Error: "summary timed out (exec credential plugin may be slow or missing)"}, false)
			<-done
			s.mu.Lock()
			if cur := s.slots[key]; cur != nil {
				cur.inflight = false
			}
			s.mu.Unlock()
			return
		}
		s.store(key, sum, true)
	}()
}

func (s *Summarizer) store(key string, sum Summary, finished bool) {
	now := s.now()
	sum.CheckedAt = &now
	s.mu.Lock()
	defer s.mu.Unlock()
	sl := s.slots[key]
	if sl == nil {
		sl = &slot{}
		s.slots[key] = sl
	}
	sl.sum, sl.at, sl.has = sum, now, true
	if finished {
		sl.inflight = false
	}
}

// Wait blocks until every fetch started so far has finished (tests).
func (s *Summarizer) Wait() { s.wg.Wait() }

func fetch(ctx context.Context, id string, base *rest.Config, timeout time.Duration) Summary {
	cfg := rest.CopyConfig(base)
	cfg.Timeout = timeout
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return Summary{ID: id, Status: StatusUnreachable, Error: err.Error()}
	}
	sum := Summary{ID: id}
	var v version.Info
	raw, err := client.Discovery().RESTClient().Get().AbsPath("/version").Do(ctx).Raw()
	if err == nil {
		err = json.Unmarshal(raw, &v)
	}
	if err != nil {
		if searchTimedOut(ctx, err) {
			return Summary{ID: id, Status: StatusUnreachable, Error: "summary timed out"}
		}
		return Summary{ID: id, Status: StatusUnreachable, Error: err.Error()}
	}
	sum.Status, sum.Version = StatusReachable, v.GitVersion
	total, ready, cont := 0, 0, ""
	for page := 0; ; page++ {
		if page == maxNodePages {
			sum.NodesTruncated = true
			break
		}
		list, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{Limit: nodePageSize, Continue: cont})
		if err != nil {
			if searchTimedOut(ctx, err) {
				sum.Error = "nodes: summary timed out"
			} else {
				sum.Error = fmt.Sprintf("nodes: %v", err)
			}
			return sum
		}
		for i := range list.Items {
			total++
			if nodeReady(&list.Items[i]) {
				ready++
			}
		}
		if cont = list.Continue; cont == "" {
			break
		}
	}
	sum.Nodes, sum.ReadyNodes = &total, &ready
	return sum
}

func nodeReady(n *corev1.Node) bool {
	for _, c := range n.Status.Conditions {
		if c.Type == corev1.NodeReady {
			return c.Status == corev1.ConditionTrue
		}
	}
	return false
}
