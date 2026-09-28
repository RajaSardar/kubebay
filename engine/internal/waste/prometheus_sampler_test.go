package waste

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"k8s.io/client-go/kubernetes/fake"
)

const fullCoverage = "2016" // expectedSteps(7d, 5m)

// fakePrometheusVectors serves the three Tier A queries (cpu p95, mem p95,
// coverage) for a single pod with fixed values, dispatching by exact query
// string equality against the same builders the sampler itself uses —
// robust to any future change in the queries' wording, unlike a substring
// match (mem's and coverage's queries both contain
// "container_memory_working_set_bytes", so a naive substring match would be
// ambiguous between them).
func fakePrometheusVectors(t *testing.T, ns, pod, cpuVal, memVal, coverageVal string) *httptest.Server {
	t.Helper()
	responses := map[string]string{
		cpuP95Query(tierAWindow):   vectorBody(t, ns, pod, cpuVal),
		memP95Query(tierAWindow):   vectorBody(t, ns, pod, memVal),
		coverageQuery(tierAWindow): vectorBody(t, ns, pod, coverageVal),
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		w.Header().Set("Content-Type", "application/json")
		if body, ok := responses[query]; ok {
			_, _ = w.Write([]byte(body))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func vectorBody(t *testing.T, ns, pod, value string) string {
	t.Helper()
	body := map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"resultType": "vector",
			"result": []interface{}{
				map[string]interface{}{
					"metric": map[string]string{"namespace": ns, "pod": pod},
					"value":  []interface{}{1700000000, value},
				},
			},
		},
	}
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestTierAForCluster_UsesFullyProbedSeries(t *testing.T) {
	pod := deploymentOwnedPod("default", "app-1", "rs-uid-1", "500m", "512Mi")
	rs := replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1")
	cs := fake.NewSimpleClientset(&pod, &rs)

	prom := fakePrometheusVectors(t, "default", "app-1", "0.3", "268435456", fullCoverage) // 0.3 cores = 300m

	s := NewSampler(nil, discardLogger())
	if err := s.tierAForCluster(context.Background(), "kind-dev", cs, prom.URL); err != nil {
		t.Fatalf("tierAForCluster: %v", err)
	}

	key := WorkloadKey{Cluster: "kind-dev", Ns: "default", Kind: "Deployment", Name: "app"}
	entry, ok := s.tierA[key]
	if !ok {
		t.Fatalf("want a Tier A entry for %+v, got none: %+v", key, s.tierA)
	}
	if entry.CPUP95Millis != 300 {
		t.Errorf("CPUP95Millis = %d, want 300", entry.CPUP95Millis)
	}
	if entry.MemP95Bytes != 268435456 {
		t.Errorf("MemP95Bytes = %d, want 268435456", entry.MemP95Bytes)
	}
}

func TestTierAForCluster_SkipsWorkloadWithInsufficientCoverage(t *testing.T) {
	pod := deploymentOwnedPod("default", "app-1", "rs-uid-1", "500m", "512Mi")
	rs := replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1")
	cs := fake.NewSimpleClientset(&pod, &rs)

	prom := fakePrometheusVectors(t, "default", "app-1", "0.3", "268435456", "500") // far short of 2016

	s := NewSampler(nil, discardLogger())
	if err := s.tierAForCluster(context.Background(), "kind-dev", cs, prom.URL); err != nil {
		t.Fatalf("tierAForCluster: %v", err)
	}

	key := WorkloadKey{Cluster: "kind-dev", Ns: "default", Kind: "Deployment", Name: "app"}
	if _, ok := s.tierA[key]; ok {
		t.Error("want no Tier A entry when coverage is insufficient — should fall back to Tier B, not show a half-probed number")
	}
}

func TestSnapshot_PrefersTierAOverTierBForTheSameWorkload(t *testing.T) {
	pod := deploymentOwnedPod("default", "app-1", "rs-uid-1", "500m", "512Mi")
	rs := replicaSet("default", "app-rs", "rs-uid-1", "dep-uid-1")
	cs := fake.NewSimpleClientset(&pod, &rs)
	mc := newFakeMetricsClient(podMetrics("default", "app-1", "50m", "64Mi"))

	s := NewSampler(nil, discardLogger())
	if err := s.sampleCluster(context.Background(), "kind-dev", cs, mc); err != nil {
		t.Fatalf("sampleCluster: %v", err)
	}

	prom := fakePrometheusVectors(t, "default", "app-1", "0.3", "268435456", fullCoverage)
	if err := s.tierAForCluster(context.Background(), "kind-dev", cs, prom.URL); err != nil {
		t.Fatalf("tierAForCluster: %v", err)
	}

	rows := s.Snapshot("kind-dev")
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d: %+v", len(rows), rows)
	}
	if rows[0].Source != "prometheus" {
		t.Errorf("Source = %q, want prometheus to win over metrics-server", rows[0].Source)
	}
	if rows[0].P95CPUMillis != 300 {
		t.Errorf("P95CPUMillis = %d, want the Prometheus value (300), not Tier B's (50)", rows[0].P95CPUMillis)
	}
}
