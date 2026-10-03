package history

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// Prometheus-backed series (backlog #36 slice 2). Same hourly shape as local
// buckets so consumers don't care where a series came from, but never mixed:
// one series is one source, and a seam between rate()'d Prometheus data and
// metrics-server point samples would read as a trend.

// promStepsPerHour is the 5m subquery resolution inside each hourly bucket.
const promStepsPerHour = 12

// containerSelector matches waste/prometheus.go: cAdvisor container metrics,
// so the only dependency is Prometheus scraping the kubelet.
const containerSelector = `container!="", container!="POD"`

type Queries struct {
	CPUMean, CPUMax, MemMean, MemMax string
}

// PromQueries builds the four per-hour queries for a namespace ("" = cluster
// total). Evaluated by query_range at a 1h step, each value covers the hour
// ending at its timestamp.
func PromQueries(ns string) Queries {
	sel := containerSelector
	if ns != "" {
		sel += `, namespace="` + escapeLabel(ns) + `"`
	}
	cpu := fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{%s}[5m]))`, sel)
	mem := fmt.Sprintf(`sum(container_memory_working_set_bytes{%s})`, sel)
	over := func(fn, expr string) string { return fmt.Sprintf(`%s((%s)[1h:5m])`, fn, expr) }
	return Queries{
		CPUMean: over("avg_over_time", cpu),
		CPUMax:  over("max_over_time", cpu),
		MemMean: over("avg_over_time", mem),
		MemMax:  over("max_over_time", mem),
	}
}

func escapeLabel(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(s)
}

type promMatrix struct {
	Status string `json:"status"`
	Error  string `json:"error"`
	Data   struct {
		Result []struct {
			Values [][2]any `json:"values"`
		} `json:"result"`
	} `json:"data"`
}

// ParseMatrix reads a query_range response into values keyed by the start of
// the hour each value covers, multiplied by scale (1000 turns CPU cores into
// millicores). NaN and unparsable values are gaps, never zeros.
func ParseMatrix(body []byte, scale float64) (map[time.Time]float64, error) {
	var m promMatrix
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, fmt.Errorf("decode prometheus response: %w", err)
	}
	if m.Status != "success" {
		return nil, fmt.Errorf("prometheus query failed: %s", m.Error)
	}
	out := map[time.Time]float64{}
	for _, r := range m.Data.Result {
		for _, v := range r.Values {
			ts, ok := v[0].(float64)
			s, ok2 := v[1].(string)
			if !ok || !ok2 {
				continue
			}
			f, err := strconv.ParseFloat(s, 64)
			if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
				continue
			}
			end := time.Unix(int64(ts), 0).UTC()
			out[end.Add(-time.Hour)] = f * scale
		}
	}
	return out, nil
}

// PromSeries assembles hourly points for [from, to) from parsed matrices.
// Requests are unknown (that needs kube-state-metrics), so they stay nil.
func PromSeries(ns string, from, to time.Time, cpuMean, cpuMax, memMean, memMax map[time.Time]float64, now time.Time, retention time.Duration, loc *time.Location) Series {
	ser := Series{Ns: ns, Source: "prometheus", Points: []Point{}}
	observed := map[time.Time]int{}
	get := func(m map[time.Time]float64, h time.Time) *float64 {
		if v, ok := m[h]; ok {
			return &v
		}
		return nil
	}
	for h := from.UTC().Truncate(time.Hour); h.Before(to); h = h.Add(time.Hour) {
		p := Point{Hour: h, CPUMean: get(cpuMean, h), CPUMax: get(cpuMax, h), MemMean: get(memMean, h), MemMax: get(memMax, h)}
		if p.CPUMean != nil || p.CPUMax != nil || p.MemMean != nil || p.MemMax != nil {
			p.Samples, p.WellSampled = promStepsPerHour, true
			observed[h] = promStepsPerHour
		}
		ser.Points = append(ser.Points, p)
	}
	ser.Coverage = coverageFromHours(observed, now, retention, promStepsPerHour, loc)
	return ser
}
