package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
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
func (h *HistoryAPI) HandleSeries(w http.ResponseWriter, r *http.Request) {
	c, ok := clusterParam(w, r)
	if !ok {
		return
	}
	if h.Recorder == nil {
		http.Error(w, "history unavailable: "+h.Unavailable, http.StatusServiceUnavailable)
		return
	}
	fp, ok := h.Recorder.FingerprintFor(c)
	if !ok {
		http.Error(w, "no history recorded for this cluster", http.StatusNotFound)
		return
	}
	q := r.URL.Query()
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
	if !from.Before(to) || to.Sub(from) > time.Duration(h.Recorder.Store().RetentionDays())*24*time.Hour {
		http.Error(w, "from must be before to, within the retention window", http.StatusBadRequest)
		return
	}
	ser, err := h.Recorder.Store().Query(fp, q.Get("ns"), from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, ser)
}

// HistoryUsageRecorder adapts the sampler's per-tick namespace totals to the
// history store. metaFor supplies the context and server for a cluster ID.
func HistoryUsageRecorder(rec *history.Recorder, metaFor func(clusterID string) history.Meta, log *slog.Logger) waste.UsageRecorder {
	return func(ctx context.Context, clusterID string, cs kubernetes.Interface, at time.Time, usage []waste.NsUsage) {
		obs := make([]history.Obs, 0, len(usage))
		for _, u := range usage {
			obs = append(obs, history.Obs{Ns: u.Ns, CPUMillis: u.CPUMillis, MemBytes: u.MemBytes, HasUsage: u.HasUsage, ReqCPUMillis: u.ReqCPUMillis, ReqMemBytes: u.ReqMemBytes})
		}
		if err := rec.Record(ctx, metaFor(clusterID), cs, at, obs); err != nil && log != nil {
			log.Warn("history: record failed", "cluster", clusterID, "err", err)
		}
	}
}
