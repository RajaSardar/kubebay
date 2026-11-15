package waste

import (
	"testing"
	"time"
)

func TestCPUP95Query(t *testing.T) {
	q := cpuP95Query("7d")
	if !containsAll(q, "quantile_over_time(0.95") {
		t.Errorf("query = %q, want quantile_over_time(0.95, ...)", q)
	}
	if !containsAll(q, "[7d:") {
		t.Errorf("query = %q, want a 7d subquery window", q)
	}
	if !containsAll(q, "container_cpu_usage_seconds_total") {
		t.Errorf("query = %q, want it to reference container_cpu_usage_seconds_total", q)
	}
	if !containsAll(q, "rate(") {
		t.Errorf("query = %q, want a rate() around the counter metric", q)
	}
}

func TestMemP95Query(t *testing.T) {
	q := memP95Query("7d")
	if !containsAll(q, "quantile_over_time(0.95") || !containsAll(q, "container_memory_working_set_bytes") {
		t.Errorf("query = %q, want quantile_over_time over container_memory_working_set_bytes", q)
	}
	// Memory is already a gauge — must NOT be wrapped in rate().
	if containsAll(q, "rate(container_memory") {
		t.Errorf("query = %q, memory must not be rate()'d — it's a gauge, not a counter", q)
	}
}

func TestCoverageQuery(t *testing.T) {
	q := coverageQuery("7d")
	if !containsAll(q, "count_over_time") {
		t.Errorf("query = %q, want count_over_time(...)", q)
	}
	if !containsAll(q, "[7d:") {
		t.Errorf("query = %q, want a 7d subquery window", q)
	}
}

func TestParsePromVectorByPodKey(t *testing.T) {
	body := []byte(`{
		"status": "success",
		"data": {
			"resultType": "vector",
			"result": [
				{"metric": {"namespace": "default", "pod": "app-1"}, "value": [1700000000, "123.45"]},
				{"metric": {"namespace": "default", "pod": "app-2"}, "value": [1700000000, "67.5"]}
			]
		}
	}`)
	got, err := parsePromVectorByPodKey(body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 entries, got %d: %+v", len(got), got)
	}
	if got["default/app-1"] != 123.45 {
		t.Errorf("default/app-1 = %v, want 123.45", got["default/app-1"])
	}
	if got["default/app-2"] != 67.5 {
		t.Errorf("default/app-2 = %v, want 67.5", got["default/app-2"])
	}
}

func TestParsePromVectorByPodKey_ErrorStatus(t *testing.T) {
	body := []byte(`{"status": "error", "error": "bad query"}`)
	if _, err := parsePromVectorByPodKey(body); err == nil {
		t.Fatal("expected an error for a failed Prometheus query")
	}
}

func TestParsePromVectorByPodKey_SkipsEntriesMissingLabels(t *testing.T) {
	body := []byte(`{
		"status": "success",
		"data": {"resultType": "vector", "result": [
			{"metric": {"namespace": "default"}, "value": [1700000000, "1"]},
			{"metric": {"pod": "app-1"}, "value": [1700000000, "1"]}
		]}
	}`)
	got, err := parsePromVectorByPodKey(body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("want 0 entries (both missing a required label), got %d: %+v", len(got), got)
	}
}

func TestExpectedSteps(t *testing.T) {
	got := expectedSteps(7*24*time.Hour, 5*time.Minute)
	want := 7.0 * 24 * 60 / 5 // 2016
	if got != want {
		t.Errorf("expectedSteps(7d, 5m) = %v, want %v", got, want)
	}
}

func TestHasSufficientCoverage(t *testing.T) {
	expected := expectedSteps(7*24*time.Hour, 5*time.Minute)
	if !hasSufficientCoverage(expected, expected) {
		t.Error("full coverage should pass")
	}
	if !hasSufficientCoverage(expected*0.95, expected) {
		t.Error("95% coverage should pass the >=90% gate")
	}
	if hasSufficientCoverage(expected*0.5, expected) {
		t.Error("50% coverage (e.g. only ~3.5d retained) should fail the gate")
	}
}
