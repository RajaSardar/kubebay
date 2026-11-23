package httpapi

import (
	"context"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

// OperatorSettings are the Prometheus settings a shared engine (in a cluster
// or with OIDC) takes from flags and environment (the Helm chart's values)
// instead of the settings API. The node-shell and debug images come from
// KUBEBAY_NODE_SHELL_IMAGE and KUBEBAY_DEBUG_IMAGE. Fixed at startup by main.
type OperatorSettings struct {
	// PrometheusURL is the Prometheus every cluster's graphs and the waste
	// sampler query directly. On the desktop it is only a fallback below
	// the URLs saved in Settings.
	PrometheusURL string
	// PrometheusAllUsers lets every signed-in OIDC user send raw PromQL to
	// PrometheusURL. Off by default: that endpoint is reached with the
	// engine's network position, not the user's RBAC.
	PrometheusAllUsers bool
}

// SharedSettingsBlockReason is why the settings API is read-only here, or "".
// In a cluster or with OIDC one engine serves many people, so the images the
// node shell and debug containers run, the Prometheus queried and the
// kubeconfigs loaded would otherwise be set by one user for everyone else.
func SharedSettingsBlockReason(inCluster, oidcEnabled bool) string {
	switch {
	case oidcEnabled:
		return "Settings are read-only when OIDC is configured: they would apply to every user, so the operator sets them through the engine's flags or the Helm chart's values."
	case inCluster:
		return "Settings are read-only when Kubebay runs in a cluster: they would apply to every user, so the operator sets them through the engine's flags or the Helm chart's values."
	}
	return ""
}

// refuseIfLocked answers 403 and returns true when shared settings are read-only.
func (s *SettingsManager) refuseIfLocked(w http.ResponseWriter) bool {
	if s.SharedLocked == "" {
		return false
	}
	http.Error(w, s.SharedLocked, http.StatusForbidden)
	return true
}

// NodeShellImage resolves the node-shell image. On the desktop the saved
// setting wins; a shared engine never reads it. Then the operator's
// KUBEBAY_NODE_SHELL_IMAGE, then the default.
func (s *SettingsManager) NodeShellImage() string {
	if s.SharedLocked == "" {
		if set, err := s.Load(); err == nil && set.NodeShellImage != "" {
			return set.NodeShellImage
		}
	}
	if v := strings.TrimSpace(os.Getenv("KUBEBAY_NODE_SHELL_IMAGE")); v != "" {
		return v
	}
	return DefaultNodeShellImage
}

// DebugImageDefault is the image a debug container gets when the request
// names none, resolved like NodeShellImage (KUBEBAY_DEBUG_IMAGE).
func (s *SettingsManager) DebugImageDefault() string {
	if s.SharedLocked == "" {
		if set, err := s.Load(); err == nil && set.DebugImage != "" {
			return set.DebugImage
		}
	}
	if v := strings.TrimSpace(os.Getenv("KUBEBAY_DEBUG_IMAGE")); v != "" && validDebugImage(v) {
		return v
	}
	return DefaultDebugImage
}

// directPromURL is the Prometheus URL the engine itself queries for a
// cluster. A shared engine uses only the operator's.
func (s *SettingsManager) directPromURL(set *AppSettings, cluster string) string {
	if s.SharedLocked != "" {
		return normalizePromURL(s.Operator.PrometheusURL)
	}
	if u := set.PrometheusURLFor(cluster); u != "" {
		return u
	}
	return normalizePromURL(s.Operator.PrometheusURL)
}

// directPromURLForRequest is directPromURL as a user's raw PromQL may use
// it: a signed-in OIDC user gets it only when the operator opted in, since
// the URL answers for every namespace whatever that user's RBAC says.
// Without it their query goes through the API server's service proxy as them.
func (s *SettingsManager) directPromURLForRequest(ctx context.Context, set *AppSettings, cluster string) string {
	if id := clusters.IdentityFromContext(ctx); id != nil && id.Name != "" && !s.Operator.PrometheusAllUsers {
		return ""
	}
	return s.directPromURL(set, cluster)
}

// SamplerPrometheusURL is where the waste sampler's Tier A queries go.
func (s *SettingsManager) SamplerPrometheusURL(cluster string) string {
	set, err := s.Load()
	if err != nil {
		set = &AppSettings{}
	}
	return s.directPromURL(set, cluster)
}

// promTargetsInForce are the pinned auto-detected Services. Pins are a
// shared setting, so a shared engine ignores any stored ones.
func (s *SettingsManager) promTargetsInForce(set *AppSettings) map[string]string {
	if s.SharedLocked != "" {
		return nil
	}
	return set.PrometheusTargets
}

// podListAccess reports whether the signed-in user may list pods in ns
// ("" = every namespace) of a cluster.
type podListAccess func(ctx context.Context, cluster, ns string) (bool, error)

const podAccessTTL = 30 * time.Second

type podAccessEntry struct {
	allowed bool
	at      time.Time
}

// podListAccessFor answers podListAccess with a SelfSubjectAccessReview made
// as the user on ctx, cached briefly per cluster, user, groups and namespace
// so one page load doesn't send a review per row.
func podListAccessFor(mgr *clusters.Manager) podListAccess {
	if mgr == nil {
		return nil
	}
	var mu sync.Mutex
	cache := map[string]podAccessEntry{}
	return func(ctx context.Context, cluster, ns string) (bool, error) {
		id := clusters.IdentityFromContext(ctx)
		key := cluster + "\x00" + ns
		if id != nil {
			groups := slices.Clone(id.Groups)
			slices.Sort(groups)
			key += "\x00" + id.Name + "\x00" + strings.Join(groups, ",")
		}
		mu.Lock()
		if e, ok := cache[key]; ok && time.Since(e.at) < podAccessTTL {
			mu.Unlock()
			return e.allowed, nil
		}
		mu.Unlock()
		cfg, err := restConfigFor(ctx, mgr, cluster)
		if err != nil {
			return false, err
		}
		cs, err := kubernetes.NewForConfig(cfg)
		if err != nil {
			return false, err
		}
		rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		review, err := cs.AuthorizationV1().SelfSubjectAccessReviews().Create(rctx, &authorizationv1.SelfSubjectAccessReview{
			Spec: authorizationv1.SelfSubjectAccessReviewSpec{
				ResourceAttributes: &authorizationv1.ResourceAttributes{Verb: "list", Resource: "pods", Namespace: ns},
			},
		}, metav1.CreateOptions{})
		if err != nil {
			return false, err
		}
		mu.Lock()
		if len(cache) > 4096 {
			for k, e := range cache {
				if time.Since(e.at) >= podAccessTTL {
					delete(cache, k)
				}
			}
		}
		cache[key] = podAccessEntry{allowed: review.Status.Allowed, at: time.Now()}
		mu.Unlock()
		return review.Status.Allowed, nil
	}
}
