package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"k8s.io/client-go/kubernetes/fake"

	"github.com/RajaSardar/kubebay/engine/internal/history"
	"github.com/RajaSardar/kubebay/engine/internal/waste"
)

func setPromURL(t *testing.T, sm *SettingsManager, cluster, url string) {
	t.Helper()
	save(t, sm, fmt.Sprintf(`{"prometheusUrls":{%q:%q}}`, cluster, url))
}

func TestHistorySeries_PrometheusSource(t *testing.T) {
	f := newHistoryFixture(t)
	hourEnd := time.Now().UTC().Truncate(time.Hour)
	var mu sync.Mutex
	var queries []string
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		queries = append(queries, r.URL.Query().Get("query"))
		mu.Unlock()
		if r.URL.Path != "/api/v1/query_range" || r.URL.Query().Get("step") != "3600" {
			http.Error(w, "unexpected "+r.URL.String(), http.StatusBadRequest)
			return
		}
		fmt.Fprintf(w, `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[[%d,"0.5"]]}]}}`, hourEnd.Unix())
	}))
	defer prom.Close()
	setPromURL(t, f.sm, "prod", prom.URL)

	from := hourEnd.Add(-2 * time.Hour).Format(time.RFC3339)
	to := hourEnd.Format(time.RFC3339)
	res := do(f.api.HandleSeries, http.MethodGet, "/x?cluster=prod&ns=shop&source=prometheus&from="+from+"&to="+to)
	if res.Code != http.StatusOK {
		t.Fatalf("status %d: %s", res.Code, res.Body)
	}
	var ser history.Series
	_ = json.Unmarshal(res.Body.Bytes(), &ser)
	if ser.Source != "prometheus" || len(ser.Points) != 2 {
		t.Fatalf("series: %+v", ser)
	}
	last := ser.Points[1]
	if last.CPUMean == nil || *last.CPUMean != 500 || ser.Points[0].CPUMean != nil {
		t.Fatalf("value for the hour ending at %v lands on the last bucket, in millicores: %+v", hourEnd, ser.Points)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(queries) != 4 || !strings.Contains(queries[0], `namespace="shop"`) {
		t.Fatalf("queries: %v", queries)
	}
}

func TestHistorySeries_PrometheusNotConfigured(t *testing.T) {
	f := newHistoryFixture(t)
	if res := do(f.api.HandleSeries, http.MethodGet, "/x?cluster=prod&source=prometheus"); res.Code != http.StatusPreconditionFailed {
		t.Fatalf("status %d", res.Code)
	}
}

func TestHistorySeries_PrometheusUnreachableNeverFallsBackToLocal(t *testing.T) {
	f := newHistoryFixture(t)
	rec := HistoryUsageRecorder(f.api.Recorder, func(id string) history.Meta { return history.Meta{ClusterID: id} }, nil)
	rec(context.Background(), "prod", fake.NewSimpleClientset(), time.Now(), []waste.NsUsage{{Ns: "", HasUsage: true, CPUMillis: 5}})
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close()
	setPromURL(t, f.sm, "prod", url)
	res := do(f.api.HandleSeries, http.MethodGet, "/x?cluster=prod&source=prometheus")
	if res.Code != http.StatusBadGateway || strings.Contains(res.Body.String(), `"source":"local"`) {
		t.Fatalf("an unreachable Prometheus is an error, not local data: %d %s", res.Code, res.Body)
	}
	if res := do(f.api.HandleSeries, http.MethodGet, "/x?cluster=prod&source=bogus"); res.Code != http.StatusBadRequest {
		t.Fatalf("unknown source: %d", res.Code)
	}
}
