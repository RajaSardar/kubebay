package searchindex

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/stream"
)

type fakeSub struct {
	snap   chan stream.Snapshot
	deltas chan []stream.Op
	reason string
	ctx    context.Context
}

func (f *fakeSub) Snapshot() <-chan stream.Snapshot { return f.snap }
func (f *fakeSub) Deltas() <-chan []stream.Op       { return f.deltas }
func (f *fakeSub) CloseReason() string              { return f.reason }

type subCall struct {
	gvr        string
	namespaces []string
	selector   string
	mode       string
}

type fakeSubscriber struct {
	mu    sync.Mutex
	subs  map[string]*fakeSub
	calls []subCall
	fail  map[string]error
}

func newFake() *fakeSubscriber {
	return &fakeSubscriber{subs: map[string]*fakeSub{}, fail: map[string]error{}}
}

func (f *fakeSubscriber) Subscribe(ctx context.Context, gvr string, namespaces []string, selector, mode string) (Sub, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, subCall{gvr, namespaces, selector, mode})
	if err := f.fail[gvr]; err != nil {
		return nil, err
	}
	s := &fakeSub{snap: make(chan stream.Snapshot, 1), deltas: make(chan []stream.Op, 16), ctx: ctx}
	f.subs[gvr] = s
	return s, nil
}

func (f *fakeSubscriber) gvrs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []string{}
	for _, c := range f.calls {
		out = append(out, c.gvr)
	}
	sort.Strings(out)
	return out
}

func (f *fakeSubscriber) callList() []subCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]subCall(nil), f.calls...)
}

func (f *fakeSubscriber) sub(gvr string) *fakeSub {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.subs[gvr]
}

func obj(op, ns, name string) stream.Op {
	meta := map[string]any{"name": name}
	if ns != "" {
		meta["namespace"] = ns
	}
	return stream.Op{Op: op, Key: ns + "/" + name, Obj: map[string]any{"metadata": meta}}
}

// eventually polls until cond holds, or fails the test.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func names(g Group) []string {
	out := []string{}
	for _, h := range g.Hits {
		out = append(out, h.Name)
	}
	return out
}

func find(r Result, slug string) *Group {
	for i := range r.Groups {
		if r.Groups[i].Slug == slug {
			return &r.Groups[i]
		}
	}
	return nil
}

var testKinds = []Kind{
	{GVR: "v1/services", Slug: "services", Label: "Services", Aliases: []string{"service", "services", "svc"}},
	{GVR: "networking.k8s.io/v1/ingresses", Slug: "ingresses", Label: "Ingresses", Aliases: []string{"ingress", "ingresses", "ing"}},
	{GVR: "v1/events", Slug: "events", Label: "Events", Aliases: []string{"event", "events", "ev"}, Tier: TierOnDemand},
}

func TestSearchFollowsOnlyTheDefaultKindsInMetadataModeAcrossAllNamespaces(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()
	ix.Search("api", SearchOptions{})
	eventually(t, "two subscriptions", func() bool { return len(f.gvrs()) == 2 })
	if got := strings.Join(f.gvrs(), ","); got != "networking.k8s.io/v1/ingresses,v1/services" {
		t.Fatalf("followed %s; want services and ingresses only, not events", got)
	}
	for _, c := range f.callList() {
		if c.mode != "metadata" || len(c.namespaces) != 0 || c.selector != "" {
			t.Errorf("%s subscribed with mode %q namespaces %v selector %q", c.gvr, c.mode, c.namespaces, c.selector)
		}
	}
}

func TestAnEmptyQueryFollowsNothing(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()
	ix.Search("", SearchOptions{})
	ix.Search("   ", SearchOptions{})
	time.Sleep(20 * time.Millisecond)
	if len(f.gvrs()) != 0 {
		t.Fatalf("an empty query must not start any watch, got %v", f.gvrs())
	}
}

func TestSearchFindsWhatArrivesInASnapshotAndFollowsChanges(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()
	ix.Search("api", SearchOptions{})
	eventually(t, "services subscription", func() bool { return f.sub("v1/services") != nil })
	svc := f.sub("v1/services")

	svc.snap <- stream.OpsSnapshot([]stream.Op{obj(stream.OpAdd, "shop", "api"), obj(stream.OpAdd, "shop", "web")})
	eventually(t, "the snapshot's api service", func() bool {
		g := find(ix.Search("api", SearchOptions{}), "services")
		return g != nil && len(g.Hits) == 1
	})

	svc.deltas <- []stream.Op{obj(stream.OpAdd, "billing", "api-v2")}
	eventually(t, "the added service", func() bool {
		g := find(ix.Search("api", SearchOptions{}), "services")
		return g != nil && g.Total == 2
	})

	svc.deltas <- []stream.Op{obj(stream.OpDelete, "shop", "api")}
	eventually(t, "the deleted service to go", func() bool {
		g := find(ix.Search("api", SearchOptions{}), "services")
		return g != nil && g.Total == 1 && names(*g)[0] == "api-v2"
	})
}

func TestSearchSaysWhichKindsAreStillListing(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()
	r := ix.Search("api", SearchOptions{})
	_ = r
	eventually(t, "both kinds pending", func() bool {
		return len(ix.Search("api", SearchOptions{}).Pending) == 2
	})
	eventually(t, "subscription", func() bool { return f.sub("v1/services") != nil && f.sub("networking.k8s.io/v1/ingresses") != nil })
	f.sub("v1/services").snap <- stream.OpsSnapshot(nil)
	eventually(t, "only ingresses pending", func() bool {
		p := ix.Search("api", SearchOptions{}).Pending
		return len(p) == 1 && p[0] == "Ingresses"
	})
}

func TestAnOnDemandKindIsFollowedOnlyWhenTheQueryNamesIt(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()

	r := ix.Search("crash", SearchOptions{})
	if len(r.OnDemand) != 1 || r.OnDemand[0] != "Events" {
		t.Fatalf("OnDemand = %v; want [Events] so the UI can say what is not searched", r.OnDemand)
	}

	r = ix.Search("events crash", SearchOptions{})
	if r.Filter != "events" {
		t.Fatalf("Filter = %q; want events", r.Filter)
	}
	eventually(t, "the events subscription", func() bool { return f.sub("v1/events") != nil })
	f.sub("v1/events").snap <- stream.OpsSnapshot([]stream.Op{obj(stream.OpAdd, "shop", "api.crashloop.1"), obj(stream.OpAdd, "shop", "web.started")})
	eventually(t, "the crashloop event", func() bool {
		g := find(ix.Search("events crash", SearchOptions{}), "events")
		return g != nil && g.Total == 1
	})
	// Once followed, it is searched by plain queries too.
	if g := find(ix.Search("crashloop", SearchOptions{}), "events"); g == nil {
		t.Error("an on-demand kind that has been followed should answer ordinary searches")
	}
}

func TestAKindTheIdentityMayNotListIsReportedAndTheRestStillWork(t *testing.T) {
	f := newFake()
	f.fail["networking.k8s.io/v1/ingresses"] = errors.New("forbidden: ingresses is forbidden")
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()
	ix.Search("api", SearchOptions{})
	eventually(t, "services subscription", func() bool { return f.sub("v1/services") != nil })
	f.sub("v1/services").snap <- stream.OpsSnapshot([]stream.Op{obj(stream.OpAdd, "shop", "api")})
	eventually(t, "a denial and a service", func() bool {
		r := ix.Search("api", SearchOptions{})
		return len(r.Denied) == 1 && r.Denied[0].Label == "Ingresses" && find(r, "services") != nil
	})
	r := ix.Search("api", SearchOptions{})
	for _, p := range r.Pending {
		if p == "Ingresses" {
			t.Error("a denied kind is not 'still loading'")
		}
	}
}

func TestAStreamTheEngineEndsIsReportedWithItsReason(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()
	ix.Search("api", SearchOptions{})
	eventually(t, "ingresses subscription", func() bool { return f.sub("networking.k8s.io/v1/ingresses") != nil })
	sub := f.sub("networking.k8s.io/v1/ingresses")
	sub.reason = "forbidden: no list on ingresses"
	close(sub.deltas)
	eventually(t, "the reason", func() bool {
		d := ix.Search("api", SearchOptions{}).Denied
		return len(d) == 1 && strings.Contains(d[0].Reason, "forbidden")
	})
}

func TestAKindThatGrowsPastItsLimitStopsAndSaysSo(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, Limits{PerKind: 3, Total: 100})
	defer ix.Close()
	ix.Search("a", SearchOptions{})
	eventually(t, "services subscription", func() bool { return f.sub("v1/services") != nil })
	var ops []stream.Op
	for _, n := range []string{"a1", "a2", "a3", "a4", "a5"} {
		ops = append(ops, obj(stream.OpAdd, "ns", n))
	}
	f.sub("v1/services").snap <- stream.OpsSnapshot(ops)
	eventually(t, "truncation", func() bool {
		r := ix.Search("a", SearchOptions{})
		return len(r.Truncated) == 1 && r.Truncated[0] == "Services" && r.Indexed == 3
	})
}

func TestCloseStopsEverySubscription(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	ix.Search("api", SearchOptions{})
	eventually(t, "subscriptions", func() bool { return len(f.gvrs()) == 2 })
	ix.Close()
	for _, g := range []string{"v1/services", "networking.k8s.io/v1/ingresses"} {
		s := f.sub(g)
		select {
		case <-s.ctx.Done():
		case <-time.After(time.Second):
			t.Errorf("%s was still subscribed after Close", g)
		}
	}
}

func TestSyntheticKindsAnswerFromTheCatalogueWithoutAWatch(t *testing.T) {
	f := newFake()
	kinds := append([]Kind{}, testKinds...)
	kinds = append(kinds, Kind{Slug: "crds", Label: "CRDs", Aliases: []string{"crd", "crds"}, Synthetic: true})
	ix := New(f, kinds, DefaultLimits)
	defer ix.Close()
	ix.SetEntries("crds", []string{"certificates.cert-manager.io", "rollouts.argoproj.io"})
	r := ix.Search("cert", SearchOptions{})
	g := find(r, "crds")
	if g == nil || g.Total != 1 || names(*g)[0] != "certificates.cert-manager.io" {
		t.Fatalf("got %+v", r.Groups)
	}
	eventually(t, "the default kinds to start", func() bool { return len(f.callList()) >= 2 })
	for _, c := range f.callList() {
		if c.gvr == "" {
			t.Error("a synthetic kind must not open a subscription")
		}
	}
}

func TestKindsAddedLaterAreFollowedWhenNamed(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()
	ix.AddKinds([]Kind{{GVR: "argoproj.io/v1alpha1/rollouts", Slug: "ext--argoproj.io--v1alpha1--rollouts", Label: "Rollouts", Aliases: []string{"rollout", "rollouts", "ro"}}})

	r := ix.Search("rollouts api", SearchOptions{})
	if r.Filter != "ext--argoproj.io--v1alpha1--rollouts" {
		t.Fatalf("Filter = %q; the new alias should name the new kind", r.Filter)
	}
	eventually(t, "the rollouts subscription", func() bool { return f.sub("argoproj.io/v1alpha1/rollouts") != nil })
	f.sub("argoproj.io/v1alpha1/rollouts").snap <- stream.OpsSnapshot([]stream.Op{obj(stream.OpAdd, "shop", "api"), obj(stream.OpAdd, "shop", "web")})
	eventually(t, "the rollout", func() bool {
		g := find(ix.Search("ro api", SearchOptions{}), "ext--argoproj.io--v1alpha1--rollouts")
		return g != nil && g.Total == 1
	})
}

func TestAddingKindsWhileSearchingIsSafe(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 200; i++ {
			ix.Search("svc api", SearchOptions{})
		}
	}()
	for i := 0; i < 50; i++ {
		ix.AddKinds([]Kind{{GVR: "x.example/v1/things" + string(rune('a'+i%26)), Slug: "t" + string(rune('a'+i%26)) + string(rune('a'+i/26)), Label: "T", Aliases: []string{"w" + string(rune('a'+i%26)) + string(rune('a'+i/26))}}})
	}
	<-done
}

func TestTheCatalogueSaysWhenItIsStillLoadingOrCouldNotLoad(t *testing.T) {
	f := newFake()
	ix := New(f, testKinds, DefaultLimits)
	defer ix.Close()

	ix.SetCatalog(true, "")
	r := ix.Search("api", SearchOptions{})
	has := func(l []string, s string) bool {
		for _, x := range l {
			if x == s {
				return true
			}
		}
		return false
	}
	if !has(r.Pending, "Custom resources") {
		t.Errorf("Pending = %v; custom resources are still being discovered", r.Pending)
	}

	ix.SetCatalog(false, "forbidden: cannot list customresourcedefinitions")
	r = ix.Search("api", SearchOptions{})
	if has(r.Pending, "Custom resources") {
		t.Error("a failed catalogue is not 'still loading'")
	}
	found := false
	for _, d := range r.Denied {
		found = found || (d.Label == "Custom resources" && strings.Contains(d.Reason, "forbidden"))
	}
	if !found {
		t.Errorf("Denied = %+v; want custom resources with the reason", r.Denied)
	}

	ix.SetCatalog(false, "")
	r = ix.Search("api", SearchOptions{})
	if has(r.Pending, "Custom resources") || len(r.Denied) != 0 && r.Denied[0].Label == "Custom resources" {
		t.Errorf("a loaded catalogue should report nothing: %+v", r)
	}
}

func TestAKindTheAppHoldsLocallyIsRecognisedButNeverFollowed(t *testing.T) {
	f := newFake()
	kinds := append(LocalKinds(), testKinds...)
	ix := New(f, kinds, DefaultLimits)
	defer ix.Close()
	// "deploy api" names Deployments, which the palette searches itself. The
	// engine must not read "deploy" as a word and answer with a Service called api-deploy.
	r := ix.Search("deploy api", SearchOptions{})
	if r.Filter != "deployments" {
		t.Fatalf("Filter = %q; the word should name the local kind", r.Filter)
	}
	if len(r.Groups) != 0 {
		t.Errorf("groups = %+v; the engine holds nothing for a local kind", r.Groups)
	}
	time.Sleep(20 * time.Millisecond)
	if len(f.gvrs()) != 0 {
		t.Errorf("naming a local kind must not start any watch, got %v", f.gvrs())
	}
	for _, label := range ix.Search("zzz", SearchOptions{}).OnDemand {
		if label == "Deployments" || label == "Pods" {
			t.Errorf("a local kind is not 'on demand': %s", label)
		}
	}
}

func TestReservedWordsAndPathsCoverEveryKindAlreadyHandled(t *testing.T) {
	aliases, covered := Reserved()
	for _, w := range []string{"pod", "deploy", "sts", "ns", "svc", "cm", "events"} {
		if aliases[w] == "" {
			t.Errorf("%q should be reserved so a custom resource can't take it", w)
		}
	}
	for _, gvr := range []string{"v1/pods", "apps/v1/deployments", "v1/services", "autoscaling.k8s.io/v1/verticalpodautoscalers", "v1/events"} {
		if !covered[gvr] {
			t.Errorf("%s is already followed and must not be added again as a custom resource", gvr)
		}
	}
}

func TestAGroupCarriesItsKindsScopeToTheCaller(t *testing.T) {
	f := newFake()
	kinds := []Kind{{GVR: "acme.example/v1/widgets", Slug: "ext--acme.example--v1--widgets", Label: "Widgets", Aliases: []string{"widget", "widgets"}, ClusterScoped: true}}
	ix := New(f, kinds, DefaultLimits)
	defer ix.Close()
	ix.Search("widget x", SearchOptions{})
	eventually(t, "subscription", func() bool { return f.sub("acme.example/v1/widgets") != nil })
	f.sub("acme.example/v1/widgets").snap <- stream.OpsSnapshot([]stream.Op{obj(stream.OpAdd, "", "x-1")})
	eventually(t, "the widget", func() bool {
		g := find(ix.Search("widget x", SearchOptions{}), "ext--acme.example--v1--widgets")
		return g != nil && g.ClusterScoped
	})
}

func TestOnDemandKindsAreListedInTheCataloguesOrderSoTheUsefulOnesComeFirst(t *testing.T) {
	kinds := []Kind{
		{GVR: "v1/events", Slug: "events", Label: "Events", Tier: TierOnDemand, Aliases: []string{"events"}},
		{GVR: "v1/leases", Slug: "leases", Label: "Leases", Tier: TierOnDemand, Aliases: []string{"leases"}},
		{GVR: "a/v1/csi", Slug: "csi", Label: "CSI Capacities", Tier: TierOnDemand, Aliases: []string{"csi"}},
	}
	ix := New(newFake(), kinds, DefaultLimits)
	defer ix.Close()
	got := ix.Search("crash", SearchOptions{}).OnDemand
	if len(got) != 3 || got[0] != "Events" || got[1] != "Leases" || got[2] != "CSI Capacities" {
		t.Fatalf("OnDemand = %v; want Events, Leases, CSI Capacities (alphabetical would lead with CSI)", got)
	}
}
