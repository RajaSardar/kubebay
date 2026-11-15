package waste

import (
	"encoding/json"
	"fmt"
	"time"
)

// coverageThreshold gates a series behind ≥90% of the expected sample count
// over the window — a proxy for the backlog's "≥7d of probed coverage": a
// [7d:step] subquery still asks for 7 days even when Prometheus has only
// retained 2, so count_over_time on the same window honestly reflects how
// much history actually exists, not just how much was requested.
const coverageThreshold = 0.90

// cAdvisor's container-level metrics (via kubelet) are used rather than
// anything from kube-state-metrics, so Tier A has no dependency beyond
// "Prometheus is scraping kubelet" — the same assumption cluster-wide CPU/
// memory dashboards already make.
const containerSelector = `{container!="", container!="POD"}`

// cpuP95Query returns the p95-over-window of each pod's total CPU usage.
// CPU is a counter, so it's rate()'d before aggregating — quantile_over_time
// then runs over the resulting (already per-pod-summed) instant vector at
// each subquery step.
func cpuP95Query(window string) string {
	return fmt.Sprintf(
		`quantile_over_time(0.95, (sum by (namespace, pod) (rate(container_cpu_usage_seconds_total%s[5m])))[%s:5m])`,
		containerSelector, window,
	)
}

// memP95Query returns the p95-over-window of each pod's total memory
// working set. Memory is already a gauge — it must never be wrapped in
// rate(), which is only meaningful for monotonic counters.
func memP95Query(window string) string {
	return fmt.Sprintf(
		`quantile_over_time(0.95, (sum by (namespace, pod) (container_memory_working_set_bytes%s))[%s:5m])`,
		containerSelector, window,
	)
}

// coverageQuery counts how many subquery steps actually had data for a pod
// over the window — see coverageThreshold's doc comment.
func coverageQuery(window string) string {
	return fmt.Sprintf(
		`count_over_time((sum by (namespace, pod) (container_memory_working_set_bytes%s))[%s:5m])`,
		containerSelector, window,
	)
}

type promVectorResponse struct {
	Status string `json:"status"`
	Error  string `json:"error"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Value  [2]interface{}    `json:"value"`
		} `json:"result"`
	} `json:"data"`
}

// parsePromVectorByPodKey parses a Prometheus instant-query response for one
// of the "by (namespace, pod)" queries above into a map keyed by
// "<namespace>/<pod>". Entries missing either label, or whose value isn't a
// parseable number, are skipped rather than causing the whole tick to fail —
// this runs over a live Prometheus's own response shape, which the engine
// doesn't control.
func parsePromVectorByPodKey(body []byte) (map[string]float64, error) {
	var resp promVectorResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("decode prometheus response: %w", err)
	}
	if resp.Status != "success" {
		return nil, fmt.Errorf("prometheus query failed: %s", resp.Error)
	}
	out := map[string]float64{}
	for _, item := range resp.Data.Result {
		ns := item.Metric["namespace"]
		pod := item.Metric["pod"]
		if ns == "" || pod == "" {
			continue
		}
		if len(item.Value) < 2 {
			continue
		}
		valStr, ok := item.Value[1].(string)
		if !ok {
			continue
		}
		var v float64
		if _, err := fmt.Sscanf(valStr, "%g", &v); err != nil {
			continue
		}
		out[ns+"/"+pod] = v
	}
	return out, nil
}

// expectedSteps is how many subquery evaluation points a [window:step]
// subquery should have if the underlying series had a full window of data.
func expectedSteps(window, step time.Duration) float64 {
	return window.Seconds() / step.Seconds()
}

func hasSufficientCoverage(observed, expected float64) bool {
	if expected <= 0 {
		return false
	}
	return observed/expected >= coverageThreshold
}
