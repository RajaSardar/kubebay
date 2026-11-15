package history

import (
	"strings"
	"testing"
	"time"
)

func TestPromQueries_RateOnlyOnCPU_AndNamespaceFilter(t *testing.T) {
	q := PromQueries("")
	if !strings.Contains(q.CPUMean, "rate(container_cpu_usage_seconds_total") || strings.Contains(q.MemMean, "rate(") {
		t.Fatalf("cpu is a counter (rate), memory a gauge (no rate): %+v", q)
	}
	for name, s := range map[string]string{"cpuMean": q.CPUMean, "memMean": q.MemMean} {
		if !strings.HasPrefix(s, "avg_over_time(") || !strings.Contains(s, "[1h:5m])") {
			t.Fatalf("%s must average over the hour: %s", name, s)
		}
	}
	for name, s := range map[string]string{"cpuMax": q.CPUMax, "memMax": q.MemMax} {
		if !strings.HasPrefix(s, "max_over_time(") {
			t.Fatalf("%s must take the hour's max: %s", name, s)
		}
	}
	if strings.Contains(q.CPUMean, "namespace=") {
		t.Fatal("cluster total must not filter by namespace")
	}
	ns := PromQueries(`sh"op`)
	if !strings.Contains(ns.MemMax, `namespace="sh\"op"`) {
		t.Fatalf("namespace must be filtered and escaped: %s", ns.MemMax)
	}
}

func TestParseMatrix_ShiftsToBucketStartAndSkipsBadValues(t *testing.T) {
	body := []byte(`{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[[1790762400,"0.25"],[1790766000,"NaN"],[1790769600,"x"],[1790773200,"1.5"]]}]}}`)
	got, err := ParseMatrix(body, 1000)
	if err != nil {
		t.Fatal(err)
	}
	end := time.Unix(1790762400, 0).UTC()
	if v, ok := got[end.Add(-time.Hour)]; !ok || v != 250 {
		t.Fatalf("value evaluated at the end of an hour belongs to the hour starting an hour earlier, scaled: %v", got)
	}
	if len(got) != 2 {
		t.Fatalf("NaN and unparsable values are gaps, not zeros: %v", got)
	}
	if _, err := ParseMatrix([]byte(`{"status":"error","error":"bad query"}`), 1); err == nil || !strings.Contains(err.Error(), "bad query") {
		t.Fatalf("prometheus errors surface: %v", err)
	}
}

func TestPromSeries_NullGapsAndCoverageFromPresentHours(t *testing.T) {
	h0 := time.Date(2026, 9, 30, 9, 0, 0, 0, time.UTC)
	now := h0.Add(3 * time.Hour)
	cpuMean := map[time.Time]float64{h0: 100, h0.Add(2 * time.Hour): 300}
	cpuMax := map[time.Time]float64{h0: 150, h0.Add(2 * time.Hour): 400}
	mem := map[time.Time]float64{h0: 10, h0.Add(2 * time.Hour): 30}
	ser := PromSeries("shop", h0, now, cpuMean, cpuMax, mem, mem, now, DefaultRetention, time.UTC)
	if ser.Source != "prometheus" || len(ser.Points) != 3 {
		t.Fatalf("source=%s points=%d", ser.Source, len(ser.Points))
	}
	if ser.Points[1].CPUMean != nil || ser.Points[1].Samples != 0 {
		t.Fatalf("missing hour must be null: %+v", ser.Points[1])
	}
	p := ser.Points[2]
	if *p.CPUMean != 300 || *p.CPUMax != 400 || !p.WellSampled || p.ReqCPUMillis != nil {
		t.Fatalf("prometheus point: %+v (requests aren't known without kube-state-metrics)", p)
	}
	if ser.Coverage.ObservedHours != 2 || ser.Coverage.ExpectedHours != 840 || ser.Coverage.HourOfDayObserved[9] != 1 {
		t.Fatalf("coverage: %+v", ser.Coverage)
	}
}
