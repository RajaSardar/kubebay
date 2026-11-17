package prometheus

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

func svc(ns, name string, labels map[string]string, ports ...corev1.ServicePort) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, Labels: labels},
		Spec:       corev1.ServiceSpec{Ports: ports, ClusterIP: "10.0.0.1"},
	}
}

func port(name string, p int32) corev1.ServicePort { return corev1.ServicePort{Name: name, Port: p} }

func TestRankPrefersKnownNamesAndSkipsNoise(t *testing.T) {
	got := Rank([]corev1.Service{
		*svc("monitoring", "alertmanager-operated", nil, port("web", 9093)),
		*svc("monitoring", "node-exporter", map[string]string{"app": "prometheus-node-exporter"}, port("metrics", 9100)),
		*svc("monitoring", "pushgateway", nil, port("http", 9091)),
		*svc("monitoring", "prometheus-operator", map[string]string{"app.kubernetes.io/name": "prometheus-operator"}, port("https", 443)),
		*svc("monitoring", "kube-state-metrics", nil, port("http", 8080)),
		*svc("monitoring", "grafana", nil, port("http", 80)),
		*svc("apps", "my-api", nil, port("http", 80)),
		*svc("monitoring", "prometheus-operated", nil, port("web", 9090)),
		*svc("monitoring", "prometheus-server", map[string]string{"app": "prometheus"}, port("http", 80)),
		*svc("obs", "thanos-query", nil, port("http", 9090)),
	})
	var names []string
	for _, c := range got {
		names = append(names, c.Namespace+"/"+c.Name)
	}
	want := []string{"monitoring/prometheus-server", "obs/thanos-query", "monitoring/prometheus-operated"}
	if len(names) != len(want) {
		t.Fatalf("candidates = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("candidates = %v, want %v", names, want)
		}
	}
}

func TestRankKnownStackNames(t *testing.T) {
	for _, name := range []string{"kube-prometheus-stack-prometheus", "prometheus-k8s", "prometheus-kube-prometheus-prometheus"} {
		got := Rank([]corev1.Service{
			*svc("a", "prometheus-operated", nil, port("web", 9090)),
			*svc("monitoring", name, nil, port("http-web", 9090)),
		})
		if len(got) != 2 || got[0].Name != name {
			t.Errorf("%s should outrank prometheus-operated, got %+v", name, got)
		}
	}
}

func TestRankFindsByLabelWhenNameIsCustom(t *testing.T) {
	got := Rank([]corev1.Service{
		*svc("team", "metrics-store", map[string]string{"app.kubernetes.io/name": "prometheus"}, port("web", 9090)),
		*svc("team", "other", nil, port("http", 80)),
	})
	if len(got) != 1 || got[0].Name != "metrics-store" {
		t.Fatalf("got %+v", got)
	}
}

func TestPortChoice(t *testing.T) {
	cases := []struct {
		name  string
		ports []corev1.ServicePort
		want  int32
		sch   string
	}{
		{"named web wins", []corev1.ServicePort{port("reloader", 8080), port("web", 9090)}, 9090, "http"},
		{"9090 without a name", []corev1.ServicePort{port("", 8080), port("", 9090)}, 9090, "http"},
		{"https named port", []corev1.ServicePort{port("https", 9091)}, 9091, "https"},
		{"fallback to first", []corev1.ServicePort{port("x", 1234)}, 1234, "http"},
	}
	for _, tc := range cases {
		got := Rank([]corev1.Service{*svc("monitoring", "prometheus", nil, tc.ports...)})
		if len(got) != 1 || got[0].Port != tc.want || got[0].Scheme != tc.sch {
			t.Errorf("%s: got %+v, want port %d %s", tc.name, got, tc.want, tc.sch)
		}
	}
}

func TestExternalNameAndPortlessSkipped(t *testing.T) {
	ext := svc("m", "prometheus", nil, port("web", 9090))
	ext.Spec.Type = corev1.ServiceTypeExternalName
	if got := Rank([]corev1.Service{*ext, *svc("m", "prometheus-server", nil)}); len(got) != 0 {
		t.Fatalf("got %+v", got)
	}
}

func TestProxyPathShape(t *testing.T) {
	c := Candidate{Namespace: "monitoring", Name: "prometheus-server", Port: 80, Scheme: "http"}
	if got, want := c.ProxyPath(), "/api/v1/namespaces/monitoring/services/prometheus-server:80/proxy"; got != want {
		t.Errorf("got %q want %q", got, want)
	}
	c.Scheme = "https"
	if got, want := c.ProxyPath(), "/api/v1/namespaces/monitoring/services/https:prometheus-server:80/proxy"; got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestParseTargetRoundTrip(t *testing.T) {
	for _, s := range []string{"monitoring/prometheus-server:80", "https:obs/prom:9091"} {
		c, err := ParseTarget(s)
		if err != nil || c.Target() != s {
			t.Errorf("%q -> %+v, %v (%q)", s, c, err, c.Target())
		}
	}
	for _, bad := range []string{"", "nonsense", "ns/name", "ns/name:abc", "/n:80", "ns/:80", "ns/a/b:80"} {
		if _, err := ParseTarget(bad); err == nil {
			t.Errorf("%q should not parse", bad)
		}
	}
}

func TestDiscoverListsAllNamespaces(t *testing.T) {
	cs := fake.NewSimpleClientset(
		svc("monitoring", "prometheus-server", nil, port("http", 80)),
		svc("default", "kubernetes", nil, port("https", 443)),
	)
	got, err := Discover(context.Background(), cs)
	if err != nil || len(got) != 1 || got[0].Target() != "monitoring/prometheus-server:80" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestDiscoverFallsBackToWellKnownNamespacesWhenClusterListDenied(t *testing.T) {
	cs := fake.NewSimpleClientset(
		svc("monitoring", "prometheus-server", nil, port("http", 80)),
		svc("secret-ns", "prometheus", nil, port("web", 9090)),
	)
	cs.PrependReactor("list", "services", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if a.GetNamespace() == "" {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "services"}, "", errors.New("no"))
		}
		return false, nil, nil
	})
	got, err := Discover(context.Background(), cs)
	if err != nil || len(got) != 1 || got[0].Namespace != "monitoring" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestDiscoverReportsErrorWhenEverythingDenied(t *testing.T) {
	cs := fake.NewSimpleClientset()
	cs.PrependReactor("list", "services", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "services"}, "", errors.New("no"))
	})
	got, err := Discover(context.Background(), cs)
	if err == nil || len(got) != 0 {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestCacheTTLAndRefresh(t *testing.T) {
	var calls int32
	load := func(context.Context) ([]Candidate, error) {
		atomic.AddInt32(&calls, 1)
		return []Candidate{{Namespace: "m", Name: "p", Port: 9090, Scheme: "http"}}, nil
	}
	now := time.Now()
	c := NewCache(time.Minute, 10*time.Second)
	c.now = func() time.Time { return now }
	ctx := context.Background()
	c.Get(ctx, "k", load, false)
	c.Get(ctx, "k", load, false)
	if calls != 1 {
		t.Fatalf("cached call reloaded: %d", calls)
	}
	c.Get(ctx, "k", load, true)
	if calls != 2 {
		t.Fatalf("refresh must reload: %d", calls)
	}
	now = now.Add(2 * time.Minute)
	c.Get(ctx, "k", load, false)
	if calls != 3 {
		t.Fatalf("expired entry must reload: %d", calls)
	}
}

func TestCacheNegativeResultIsShortLivedAndQuiet(t *testing.T) {
	var calls int32
	load := func(context.Context) ([]Candidate, error) {
		atomic.AddInt32(&calls, 1)
		return nil, errors.New("forbidden")
	}
	now := time.Now()
	c := NewCache(time.Minute, 10*time.Second)
	c.now = func() time.Time { return now }
	r := c.Get(context.Background(), "k", load, false)
	if len(r.Candidates) != 0 || r.Err == "" {
		t.Fatalf("result %+v", r)
	}
	c.Get(context.Background(), "k", load, false)
	if calls != 1 {
		t.Fatalf("negative result should be cached: %d", calls)
	}
	now = now.Add(11 * time.Second)
	c.Get(context.Background(), "k", load, false)
	if calls != 2 {
		t.Fatalf("negative result should expire quickly: %d", calls)
	}
}
