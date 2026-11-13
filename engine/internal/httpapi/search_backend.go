package httpapi

import (
	"context"
	"errors"
	"sort"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/metadata"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/informers"
	"github.com/RajaSardar/kubebay/engine/internal/searchindex"
)

// poolBackend is SearchBackend over the engine's real pools.
type poolBackend struct {
	reg *informers.PoolRegistry
	mgr *clusters.Manager
}

// NewPoolSearchBackend reads from the engine's shared informer pools.
func NewPoolSearchBackend(reg *informers.PoolRegistry, mgr *clusters.Manager) SearchBackend {
	return poolBackend{reg: reg, mgr: mgr}
}

func (b poolBackend) Connect(cluster string) error {
	if b.mgr == nil {
		return nil
	}
	return b.mgr.Connect(cluster)
}

func (b poolBackend) Pool(ctx context.Context, cluster string) (SearchPool, error) {
	p, err := b.reg.For(ctx, cluster)
	if err != nil {
		return nil, err
	}
	return poolAdapter{p}, nil
}

type poolAdapter struct{ p *informers.Pool }

func (a poolAdapter) Subscribe(ctx context.Context, gvr string, namespaces []string, selector, mode string) (searchindex.Sub, error) {
	s, err := a.p.Subscribe(ctx, gvr, namespaces, selector, mode)
	if err != nil {
		return nil, err // not s: a nil *Subscription in an interface is not nil
	}
	return s, nil
}
func (a poolAdapter) Closed() bool { return a.p.Closed() }
func (a poolAdapter) Key() any     { return a.p }

var crdGVR = schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}

// ListCRDs finds the cluster's custom resources cheaply. It reads only the
// names of the CRDs (metadata, no schemas, which run to megabytes) and takes the
// kind, scope and short names from API discovery.
func (b poolBackend) ListCRDs(ctx context.Context, cluster string) ([]searchindex.CRD, error) {
	if b.mgr == nil {
		return nil, errors.New("no cluster manager")
	}
	cfg, err := b.mgr.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(ctx))
	if err != nil {
		return nil, err
	}
	md, err := metadata.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	list, err := md.Resource(crdGVR).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	names := make(map[string]bool, len(list.Items))
	for _, it := range list.Items {
		names[it.Name] = true
	}
	dc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		return nil, err
	}
	// Partial results are normal: one broken aggregated API fails its group, not the rest.
	_, lists, err := dc.ServerGroupsAndResources()
	if len(lists) == 0 && err != nil {
		return nil, err
	}
	return crdsFromDiscovery(lists, names), nil
}

func hasVerb(verbs metav1.Verbs, v string) bool {
	for _, x := range verbs {
		if x == v {
			return true
		}
	}
	return false
}

// crdsFromDiscovery keeps the resources that are custom resources (their
// "plural.group" is a CRD's name) and can be listed and watched.
func crdsFromDiscovery(lists []*metav1.APIResourceList, crdNames map[string]bool) []searchindex.CRD {
	var out []searchindex.CRD
	seen := map[string]bool{}
	for _, l := range lists {
		if l == nil {
			continue
		}
		gv, err := schema.ParseGroupVersion(l.GroupVersion)
		if err != nil || gv.Group == "" {
			continue
		}
		for _, r := range l.APIResources {
			if strings.Contains(r.Name, "/") || !hasVerb(r.Verbs, "list") || !hasVerb(r.Verbs, "watch") {
				continue
			}
			name := r.Name + "." + gv.Group
			if !crdNames[name] || seen[name] {
				continue
			}
			seen[name] = true
			out = append(out, searchindex.CRD{
				Name: name, Group: gv.Group, Version: gv.Version, Plural: r.Name,
				Singular: r.SingularName, Kind: r.Kind, ShortNames: r.ShortNames, Namespaced: r.Namespaced,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
