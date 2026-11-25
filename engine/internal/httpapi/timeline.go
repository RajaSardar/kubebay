package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/audit"
	"github.com/RajaSardar/kubebay/engine/internal/timeline"
)

// TimelineAPI serves the desktop change timeline (backlog 82). Every handler
// refuses on a shared engine by itself, not only at setup: the store is
// per user and cannot be served to anyone else.
type TimelineAPI struct {
	Manager  *timeline.Manager
	Settings *SettingsManager
	Audit    *audit.Logger
	// Known reports whether the desktop user has this cluster connected, so a
	// caller cannot read rows for a cluster they never opened.
	Known func(cluster string) bool
	// Shared, when set, is why the timeline is off here (TimelineBlockReason).
	Shared string
}

// TimelineBlockReason is why the change timeline is not kept here, or "". It
// is one file under one user's config directory, recorded with that user's
// own access; a shared engine has many users and no such directory.
func TimelineBlockReason(inCluster, oidcEnabled bool) string {
	switch {
	case oidcEnabled:
		return "The change timeline is not kept when OIDC or an auth proxy is configured: it is a per-user file on the desktop, and one user's record cannot be served to others."
	case inCluster:
		return "The change timeline is not kept for in-cluster deployments: it is a per-user file on the desktop, and one user's record cannot be served to others."
	}
	return ""
}

const (
	// timelineGapSlack is the shortest hole shown as a gap; the recorder
	// moves a span's end every flush, so shorter is bookkeeping.
	timelineGapSlack = 15 * time.Second
	// timelineMaxCoverageKinds bounds the bands one response carries.
	timelineMaxCoverageKinds = 24
	maxFilterLen             = 253
)

func (t *TimelineAPI) blocked(w http.ResponseWriter) bool {
	if t.Shared == "" {
		return false
	}
	http.Error(w, t.Shared, http.StatusForbidden)
	return true
}

// cluster reads and checks ?cluster=.
func (t *TimelineAPI) cluster(w http.ResponseWriter, r *http.Request) (string, bool) {
	c := r.URL.Query().Get("cluster")
	if c == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return "", false
	}
	if len(c) > maxFilterLen || t.Known == nil || !t.Known(c) {
		http.Error(w, "cluster is not connected", http.StatusForbidden)
		return "", false
	}
	return c, true
}

func (t *TimelineAPI) store(w http.ResponseWriter) timeline.Store {
	st := t.Manager.Store()
	if st == nil {
		msg := "The change timeline is off. Turn it on under Settings, Change timeline."
		if e := t.Manager.Status().Error; e != "" {
			msg = "The change timeline is unavailable: " + e
		}
		http.Error(w, msg, http.StatusConflict)
	}
	return st
}

// HandleStatus reports whether recording is on and how full the store is.
func (t *TimelineAPI) HandleStatus(w http.ResponseWriter, r *http.Request) {
	if t.blocked(w) {
		return
	}
	writeJSON(w, t.Manager.Status())
}

// HandleFacets lists the values the page's filters can offer.
func (t *TimelineAPI) HandleFacets(w http.ResponseWriter, r *http.Request) {
	if t.blocked(w) {
		return
	}
	c, ok := t.cluster(w, r)
	if !ok {
		return
	}
	st := t.store(w)
	if st == nil {
		return
	}
	f, err := st.Facets(c)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, f)
}

type kindCoverage struct {
	Kind string         `json:"kind"`
	Gaps []timeline.Gap `json:"gaps"`
}

// HandleChanges returns a page of changes plus, for each kind shown, the
// periods nothing was recording it.
func (t *TimelineAPI) HandleChanges(w http.ResponseWriter, r *http.Request) {
	if t.blocked(w) {
		return
	}
	c, ok := t.cluster(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	tq := timeline.Query{Cluster: c, Namespace: q.Get("namespace"), Kind: q.Get("kind"), Manager: q.Get("manager"), Cursor: q.Get("cursor")}
	for _, v := range []string{tq.Namespace, tq.Kind, tq.Manager, tq.Cursor} {
		if len(v) > maxFilterLen {
			http.Error(w, "filter too long", http.StatusBadRequest)
			return
		}
	}
	for name, dst := range map[string]*time.Time{"from": &tq.From, "to": &tq.To} {
		if v := q.Get(name); v != "" {
			ts, err := time.Parse(time.RFC3339, v)
			if err != nil {
				http.Error(w, "bad "+name+": want RFC 3339", http.StatusBadRequest)
				return
			}
			*dst = ts
		}
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			http.Error(w, "limit must be a positive number", http.StatusBadRequest)
			return
		}
		tq.Limit = min(n, timeline.MaxQueryLimit)
	}
	st := t.store(w)
	if st == nil {
		return
	}
	page, err := st.Query(tq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	now := time.Now()
	from, to := tq.From, tq.To
	if to.IsZero() || to.After(now) {
		to = now
	}
	if from.IsZero() {
		from = now.Add(-time.Duration(t.Manager.Retention()) * 24 * time.Hour)
	}
	kinds := []string{tq.Kind}
	if tq.Kind == "" {
		f, err := st.Facets(c)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		kinds = f.Kinds
		if len(kinds) > timelineMaxCoverageKinds {
			kinds = kinds[:timelineMaxCoverageKinds]
		}
	}
	cov := make([]kindCoverage, 0, len(kinds))
	for _, k := range kinds {
		spans, err := st.Spans(c, k, from, to)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		cov = append(cov, kindCoverage{Kind: k, Gaps: nonNilGaps(timeline.Gaps(timeline.SpansFor(spans, tq.Namespace), from, to, timelineGapSlack))})
	}
	changes := page.Changes
	if changes == nil {
		changes = []timeline.Change{}
	}
	writeJSON(w, map[string]any{
		"changes": changes, "nextCursor": page.NextCursor, "coverage": cov,
		"from": from, "to": to, "dropped": t.Manager.Status().Dropped,
	})
}

func nonNilGaps(g []timeline.Gap) []timeline.Gap {
	if g == nil {
		return []timeline.Gap{}
	}
	return g
}

// HandleSettings sets the retention: 0 (off, deleting the file) to 30 days.
func (t *TimelineAPI) HandleSettings(w http.ResponseWriter, r *http.Request) {
	if t.blocked(w) {
		return
	}
	var in struct {
		RetentionDays *int `json:"retentionDays"`
	}
	if err := decodeBody(r, &in); err != nil || in.RetentionDays == nil {
		http.Error(w, "retentionDays required", http.StatusBadRequest)
		return
	}
	days := *in.RetentionDays
	if days < 0 || days > timeline.MaxRetentionDays {
		http.Error(w, fmt.Sprintf("retentionDays must be between 0 and %d", timeline.MaxRetentionDays), http.StatusBadRequest)
		return
	}
	if err := t.Settings.SetTimelineRetentionDays(days); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := t.Manager.SetRetention(days); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	t.Audit.RecordCtx(r.Context(), audit.Entry{Action: "timeline-retention", GVR: "kubebay/timeline",
		Detail: fmt.Sprintf("retentionDays=%d", days)})
	writeJSON(w, t.Manager.Status())
}

// HandleClear deletes one cluster's recorded changes (?cluster=), or all of
// them with no cluster. It does not turn recording off.
func (t *TimelineAPI) HandleClear(w http.ResponseWriter, r *http.Request) {
	if t.blocked(w) {
		return
	}
	c := r.URL.Query().Get("cluster")
	if c != "" {
		var ok bool
		if c, ok = t.cluster(w, r); !ok {
			return
		}
	}
	st := t.store(w)
	if st == nil {
		return
	}
	if err := st.Clear(c); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	detail := "all clusters"
	if c != "" {
		detail = "cluster " + c
	}
	t.Audit.RecordCtx(r.Context(), audit.Entry{Action: "timeline-clear", Cluster: c, GVR: "kubebay/timeline", Detail: detail})
	writeJSON(w, map[string]bool{"cleared": true})
}
