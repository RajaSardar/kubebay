package httpapi

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/history"
	"github.com/RajaSardar/kubebay/engine/internal/waste"
)

// HistoryAPI serves the local usage history (backlog #36). Recorder is nil
// when the history directory couldn't be opened; Unavailable then says why,
// and consent is still stored so recording starts once the store works.
type HistoryAPI struct {
	Recorder    *history.Recorder
	Settings    *SettingsManager
	Unavailable string
	// HTTP queries Prometheus for source=prometheus series (default: 30s timeout).
	HTTP *http.Client
}

func clusterParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	c := r.URL.Query().Get("cluster")
	if c == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return "", false
	}
	return c, true
}

// HandleEnroll is called when the user connects to a cluster.
func (h *HistoryAPI) HandleEnroll(w http.ResponseWriter, r *http.Request) {
	c, ok := clusterParam(w, r)
	if !ok {
		return
	}
	on, err := h.Settings.EnrollHistory(c)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"recording": on})
}

// HandleRecording is the explicit toggle: PUT ?cluster=&on=true|false.
func (h *HistoryAPI) HandleRecording(w http.ResponseWriter, r *http.Request) {
	c, ok := clusterParam(w, r)
	if !ok {
		return
	}
	on, err := strconv.ParseBool(r.URL.Query().Get("on"))
	if err != nil {
		http.Error(w, "on must be true or false", http.StatusBadRequest)
		return
	}
	if err := h.Settings.SetHistoryRecording(c, on); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"recording": on})
}

// HandleErase deletes all of a cluster's recorded history.
func (h *HistoryAPI) HandleErase(w http.ResponseWriter, r *http.Request) {
	c, ok := clusterParam(w, r)
	if !ok {
		return
	}
	if h.Recorder == nil {
		writeJSON(w, map[string]int{"erased": 0})
		return
	}
	n, err := h.Recorder.Erase(c)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, map[string]int{"erased": n})
}

func (h *HistoryAPI) HandleStatus(w http.ResponseWriter, r *http.Request) {
	c, ok := clusterParam(w, r)
	if !ok {
		return
	}
	out := map[string]any{"cluster": c, "recording": h.Settings.HistoryEnabled(c)}
	if h.Recorder == nil {
		out["available"] = false
		out["reason"] = h.Unavailable
		writeJSON(w, out)
		return
	}
	st := h.Recorder.Store()
	out["available"] = true
	out["readOnly"] = st.ReadOnly()
	out["path"] = st.Dir()
	out["retentionDays"] = st.RetentionDays()
	if fp, ok := h.Recorder.FingerprintFor(c); ok {
		cov, err := st.Status(fp)
		if err == nil {
			out["coverage"] = cov
		}
	}
	writeJSON(w, out)
}

// HandleSeries returns hourly points for one namespace (ns omitted = cluster
// total) between from and to (RFC 3339; default the last 7 days).
// source=local (default) reads the recorded history; source=prometheus asks
// the cluster's configured Prometheus for the same hourly shape. One series
// is always one source: an unreachable Prometheus is an error, never a
// silent fallback to local data.
func (h *HistoryAPI) HandleSeries(w http.ResponseWriter, r *http.Request) {
	c, ok := clusterParam(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	retention := history.DefaultRetention
	if h.Recorder != nil {
		retention = time.Duration(h.Recorder.Store().RetentionDays()) * 24 * time.Hour
	}
	to := time.Now()
	if v := q.Get("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			http.Error(w, "bad to", http.StatusBadRequest)
			return
		}
		to = t
	}
	from := to.Add(-7 * 24 * time.Hour)
	if v := q.Get("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			http.Error(w, "bad from", http.StatusBadRequest)
			return
		}
		from = t
	}
	if !from.Before(to) || to.Sub(from) > retention {
		http.Error(w, "from must be before to, within the retention window", http.StatusBadRequest)
		return
	}

	switch q.Get("source") {
	case "", "local":
		h.localSeries(w, c, q.Get("ns"), from, to)
	case "prometheus":
		h.promSeries(w, r, c, q.Get("ns"), from, to, retention)
	default:
		http.Error(w, "source must be local or prometheus", http.StatusBadRequest)
	}
}

// summaryBucket keeps a week's sparkline at 42 points: enough shape for a
// table cell, few enough to send every recorded cluster in one response.
const summaryBucket = 4 * time.Hour

// HandleSummary returns the cluster-total summary of every cluster with
// recorded history over the last ?days= (default 7), in one call, for the
// clusters list. History being off or unavailable is an empty answer, not
// an error: the list page still renders.
func (h *HistoryAPI) HandleSummary(w http.ResponseWriter, r *http.Request) {
	days := 7
	if v := r.URL.Query().Get("days"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > int(history.DefaultRetention/(24*time.Hour)) {
			http.Error(w, "days must be between 1 and the retention window", http.StatusBadRequest)
			return
		}
		days = n
	}
	out := map[string]any{"available": h.Recorder != nil, "bucketHours": int(summaryBucket / time.Hour)}
	clusters := map[string]history.Summary{}
	if h.Recorder != nil {
		to := time.Now()
		from := to.Add(-time.Duration(days) * 24 * time.Hour)
		for id, fp := range h.Recorder.AllFingerprints() {
			clusters[id] = h.Recorder.Store().Summary(fp, from, to, summaryBucket)
		}
	}
	out["clusters"] = clusters
	writeJSON(w, out)
}

func (h *HistoryAPI) localSeries(w http.ResponseWriter, c, ns string, from, to time.Time) {
	if h.Recorder == nil {
		http.Error(w, "history unavailable: "+h.Unavailable, http.StatusServiceUnavailable)
		return
	}
	fp, ok := h.Recorder.FingerprintFor(c)
	if !ok {
		http.Error(w, "no history recorded for this cluster", http.StatusNotFound)
		return
	}
	ser, err := h.Recorder.Store().Query(fp, ns, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, ser)
}

func (h *HistoryAPI) promSeries(w http.ResponseWriter, r *http.Request, c, ns string, from, to time.Time, retention time.Duration) {
	set, err := h.Settings.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	base := set.PrometheusURLFor(c)
	if base == "" {
		http.Error(w, "no Prometheus configured for this cluster", http.StatusPreconditionFailed)
		return
	}
	// Buckets start at each hour in [from, to); each value is evaluated at the
	// hour's end, so query from the first bucket's end to the last bucket's end.
	first := from.UTC().Truncate(time.Hour)
	last := to.UTC().Add(-time.Nanosecond).Truncate(time.Hour)
	params := map[string]string{
		"start": strconv.FormatInt(first.Add(time.Hour).Unix(), 10),
		"end":   strconv.FormatInt(last.Add(time.Hour).Unix(), 10),
		"step":  "3600",
	}
	qs := history.PromQueries(ns)
	results := make([]map[time.Time]float64, 4)
	for i, item := range []struct {
		query string
		scale float64
	}{{qs.CPUMean, 1000}, {qs.CPUMax, 1000}, {qs.MemMean, 1}, {qs.MemMax, 1}} {
		params["query"] = item.query
		u, err := buildPromURL(base, "/api/v1/query_range", params)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		m, err := h.fetchMatrix(r.Context(), u, item.scale)
		if err != nil {
			http.Error(w, "prometheus: "+err.Error(), http.StatusBadGateway)
			return
		}
		results[i] = m
	}
	writeJSON(w, history.PromSeries(ns, from, to, results[0], results[1], results[2], results[3], time.Now(), retention, time.Local))
}

func (h *HistoryAPI) fetchMatrix(ctx context.Context, u string, scale float64) (map[time.Time]float64, error) {
	client := h.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return history.ParseMatrix(body, scale)
}

// HistoryUsageRecorder adapts the sampler's per-tick namespace totals to the
// history store. metaFor supplies the context and server for a cluster ID.
func HistoryUsageRecorder(rec *history.Recorder, metaFor func(clusterID string) history.Meta, log *slog.Logger) waste.UsageRecorder {
	return func(ctx context.Context, clusterID string, cs kubernetes.Interface, at time.Time, usage []waste.NsUsage) {
		obs := make([]history.Obs, 0, len(usage))
		for _, u := range usage {
			obs = append(obs, history.Obs{Ns: u.Ns, CPUMillis: u.CPUMillis, MemBytes: u.MemBytes, HasUsage: u.HasUsage, ReqCPUMillis: u.ReqCPUMillis, ReqMemBytes: u.ReqMemBytes, AllocCPUMillis: u.AllocCPUMillis, AllocMemBytes: u.AllocMemBytes, Nodes: u.Nodes})
		}
		if err := rec.Record(ctx, metaFor(clusterID), cs, at, obs); err != nil && log != nil {
			log.Warn("history: record failed", "cluster", clusterID, "err", err)
		}
	}
}
