package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/RajaSardar/kubebay/engine/internal/waste"
)

type fakeSnapshotter struct {
	byCluster map[string][]waste.WorkloadWaste
}

func (f fakeSnapshotter) Snapshot(cluster string) []waste.WorkloadWaste {
	return f.byCluster[cluster]
}

func TestWasteWorkloadsHandler_RequiresCluster(t *testing.T) {
	h := wasteWorkloadsHandler(fakeSnapshotter{})
	req := httptest.NewRequest(http.MethodGet, "/api/waste/workloads", nil)
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when cluster is missing", rec.Code)
	}
}

func TestWasteWorkloadsHandler_ReturnsSnapshotForCluster(t *testing.T) {
	rows := []waste.WorkloadWaste{
		{Cluster: "kind-dev", Ns: "default", Kind: "Deployment", Name: "app", RequestedCPUMillis: 500, P95CPUMillis: 100, Source: "metrics-server", Window: "observed over 1h, 60 samples"},
	}
	h := wasteWorkloadsHandler(fakeSnapshotter{byCluster: map[string][]waste.WorkloadWaste{"kind-dev": rows}})
	req := httptest.NewRequest(http.MethodGet, "/api/waste/workloads?cluster=kind-dev", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []waste.WorkloadWaste
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].Name != "app" {
		t.Errorf("got %+v, want the single seeded row", got)
	}
}

func TestWasteWorkloadsHandler_EmptyWhenSnapshotterUnset(t *testing.T) {
	h := wasteWorkloadsHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/waste/workloads?cluster=kind-dev", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 even with no sampler wired up", rec.Code)
	}
	var got []waste.WorkloadWaste
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d rows, want 0", len(got))
	}
}

func TestWasteWorkloadsHandler_EmptyForUnknownCluster(t *testing.T) {
	h := wasteWorkloadsHandler(fakeSnapshotter{byCluster: map[string][]waste.WorkloadWaste{"a": {{Name: "x"}}}})
	req := httptest.NewRequest(http.MethodGet, "/api/waste/workloads?cluster=b", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	var got []waste.WorkloadWaste
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d rows for an unknown cluster, want 0", len(got))
	}
}
