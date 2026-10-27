package waste

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	ktesting "k8s.io/client-go/testing"
)

// The sampler walks every pod of every connected cluster each minute. One
// list request for all of them held the whole list at once: about 1.6 GB of
// garbage a minute at 100k pods (KB-02, docs/PERFORMANCE.md). It lists a page
// at a time, and every page counts.

// pagedClientset serves pods and ReplicaSets one to a page, whatever the
// limit asked, and records each list's options.
func pagedClientset(pods []corev1.Pod, rss []appsv1.ReplicaSet) (*fake.Clientset, map[string][]metav1.ListOptions) {
	cs := fake.NewSimpleClientset()
	seen := map[string][]metav1.ListOptions{}
	page := func(resource string, n int, item func(i int) runtime.Object, list func(item runtime.Object, cont string) runtime.Object) {
		cs.PrependReactor("list", resource, func(action ktesting.Action) (bool, runtime.Object, error) {
			opts := action.(ktesting.ListActionImpl).GetListOptions()
			seen[resource] = append(seen[resource], opts)
			i := 0
			if opts.Continue != "" {
				i, _ = strconv.Atoi(strings.TrimPrefix(opts.Continue, "page-"))
			}
			if i >= n {
				return true, nil, fmt.Errorf("no page %d", i)
			}
			cont := ""
			if i+1 < n {
				cont = fmt.Sprintf("page-%d", i+1)
			}
			return true, list(item(i), cont), nil
		})
	}
	page("pods", len(pods), func(i int) runtime.Object { return &pods[i] }, func(item runtime.Object, cont string) runtime.Object {
		return &corev1.PodList{ListMeta: metav1.ListMeta{Continue: cont}, Items: []corev1.Pod{*item.(*corev1.Pod)}}
	})
	page("replicasets", len(rss), func(i int) runtime.Object { return &rss[i] }, func(item runtime.Object, cont string) runtime.Object {
		return &appsv1.ReplicaSetList{ListMeta: metav1.ListMeta{Continue: cont}, Items: []appsv1.ReplicaSet{*item.(*appsv1.ReplicaSet)}}
	})
	return cs, seen
}

func checkPaged(t *testing.T, seen map[string][]metav1.ListOptions, resource string, pages int) {
	t.Helper()
	calls := seen[resource]
	if len(calls) != pages {
		t.Fatalf("%s: %d list requests, want %d (one per page)", resource, len(calls), pages)
	}
	for i, opts := range calls {
		if opts.Limit != listPageSize {
			t.Errorf("%s request %d: limit %d, want %d", resource, i, opts.Limit, listPageSize)
		}
		if want := map[bool]string{true: "", false: fmt.Sprintf("page-%d", i)}[i == 0]; opts.Continue != want {
			t.Errorf("%s request %d: continue %q, want %q", resource, i, opts.Continue, want)
		}
	}
}

func TestSampleClusterListsAPageAtATime(t *testing.T) {
	// Two ReplicaSets of one Deployment, a pod each; every object on its own page.
	pods := []corev1.Pod{
		deploymentOwnedPod("default", "app-1", "rs-uid-1", "100m", "128Mi"),
		deploymentOwnedPod("default", "app-2", "rs-uid-2", "100m", "128Mi"),
	}
	rss := []appsv1.ReplicaSet{
		replicaSet("default", "app-rs-1", "rs-uid-1", "dep-uid-1"),
		replicaSet("default", "app-rs-2", "rs-uid-2", "dep-uid-1"),
	}
	cs, seen := pagedClientset(pods, rss)
	mc := newFakeMetricsClient(podMetrics("default", "app-1", "50m", "64Mi"), podMetrics("default", "app-2", "30m", "32Mi"))

	s := NewSampler(nil, discardLogger())
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, mc); err != nil {
		t.Fatalf("sampleCluster: %v", err)
	}
	checkPaged(t, seen, "pods", 2)
	checkPaged(t, seen, "replicasets", 2)

	rows := s.Snapshot("kind-dev")
	if len(rows) != 1 || rows[0].Name != "app" || rows[0].PodCount != 2 || rows[0].RequestedCPUMillis != 200 || rows[0].P95CPUMillis != 80 {
		t.Fatalf("rows = %+v, want Deployment app with both pages' pods: 2 pods, 200m requested, 80m used", rows)
	}
}

func TestTierAListsAPageAtATime(t *testing.T) {
	// The pod Prometheus knows is on the second page, its ReplicaSet too.
	pods := []corev1.Pod{
		deploymentOwnedPod("default", "other-1", "rs-uid-0", "100m", "128Mi"),
		deploymentOwnedPod("default", "app-1", "rs-uid-1", "500m", "512Mi"),
	}
	rss := []appsv1.ReplicaSet{
		replicaSet("default", "other-rs", "rs-uid-0", "dep-uid-0"),
		replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1"),
	}
	cs, seen := pagedClientset(pods, rss)
	prom := fakePrometheusVectors(t, "default", "app-1", "0.3", "268435456", fullCoverage)

	s := NewSampler(nil, discardLogger())
	if err := s.tierAForCluster(context.Background(), "kind-dev", cs, prom.URL); err != nil {
		t.Fatalf("tierAForCluster: %v", err)
	}
	checkPaged(t, seen, "pods", 2)
	checkPaged(t, seen, "replicasets", 2)
	if _, ok := s.tierA[WorkloadKey{Cluster: "kind-dev", Ns: "default", Kind: "Deployment", Name: "app"}]; !ok {
		t.Fatalf("no Tier A entry for app, whose pod and ReplicaSet are on the second page: %+v", s.tierA)
	}
}

// A tick has 20 s, and a real client waits its turn: by default client-go
// allows a burst of 10 requests, then 5 a second. At 500 a page, 100k pods
// took 200 requests, so every tick ran out of time and the Cost page stopped
// updating past about 55k pods. A big cluster keeps old ReplicaSets too (10
// per Deployment by default), as many as its pods. The fake clientset above
// has no rate limit, so this one lists through the sampler's own client from
// an API server of its own.
func TestATickAt100kPodsAndReplicaSetsFinishes(t *testing.T) {
	const n = 100_000
	pod := deploymentOwnedPod("default", "", "rs-uid-1", "10m", "16Mi")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit, _ := strconv.Atoi(q.Get("limit"))
		start, _ := strconv.Atoi(q.Get("continue"))
		if limit <= 0 {
			limit = n
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/pods":
			end := min(start+limit, n)
			list := corev1.PodList{TypeMeta: metav1.TypeMeta{Kind: "PodList", APIVersion: "v1"}}
			for i := start; i < end; i++ {
				p := pod
				p.Name = fmt.Sprintf("app-%d", i)
				list.Items = append(list.Items, p)
			}
			if end < n {
				list.Continue = strconv.Itoa(end)
			}
			_ = json.NewEncoder(w).Encode(list)
		case "/apis/apps/v1/replicasets":
			// The pods' ReplicaSet and n-1 others, old revisions of other Deployments.
			end := min(start+limit, n)
			list := appsv1.ReplicaSetList{TypeMeta: metav1.TypeMeta{Kind: "ReplicaSetList", APIVersion: "apps/v1"}}
			for i := start; i < end; i++ {
				uid := fmt.Sprintf("rs-uid-%d", i+1)
				list.Items = append(list.Items, replicaSet("default", "rs-"+uid, uid, fmt.Sprintf("dep-uid-%d", i+1)))
			}
			if end < n {
				list.Continue = strconv.Itoa(end)
			}
			_ = json.NewEncoder(w).Encode(list)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	cs, err := samplerClient(&rest.Config{Host: srv.URL})
	if err != nil {
		t.Fatal(err)
	}

	s := NewSampler(nil, discardLogger())
	if err := s.sampleCluster(context.Background(), "big", cs, newFakeMetricsClient()); err != nil {
		t.Fatalf("sampleCluster at %d pods: %v", n, err)
	}
	// No metrics here, so Snapshot has no rows yet; the tick's requests do.
	if got := s.requested[WorkloadKey{Cluster: "big", Ns: "default", Kind: "Deployment", Name: "app"}].PodCount; got != n {
		t.Fatalf("Deployment app requested by %d pods, want all %d", got, n)
	}
}

// The pages a tick needs at the PRD's 100k pods, with as many old
// ReplicaSets, fit its client's rate limit in half the tick: the other half
// is the API server's own time, which on a remote cluster can be most of it.
func TestATicksPagesFitItsClientsRateLimit(t *testing.T) {
	base := &rest.Config{Host: "https://cluster.example"}
	cfg := samplerConfig(base)
	if base.QPS != 0 || base.Burst != 0 {
		t.Fatal("samplerConfig changed the cluster's config, which other clients share")
	}
	qps, burst := cfg.QPS, cfg.Burst
	if qps == 0 {
		qps = rest.DefaultQPS
	}
	if burst == 0 {
		burst = rest.DefaultBurst
	}
	const n = 100_000
	pages := 2*((n+listPageSize-1)/listPageSize) + 1 // pods, ReplicaSets, metrics
	allowed := float64(burst) + float64(qps)*tickTimeout.Seconds()/2
	if float64(pages) > allowed {
		t.Fatalf("a tick needs %d requests; its client allows %.0f in %v (burst %d, %.0f a second)", pages, allowed, tickTimeout/2, burst, qps)
	}
}
