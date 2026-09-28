package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// buildPromURL joins a Prometheus base URL with an API path and query
// params. Pulled out of the handlers below so it's testable without a live
// HTTP round trip, and shared between the range and instant query proxies
// so they can't drift.
func buildPromURL(base, path string, params map[string]string) (string, error) {
	up, err := url.Parse(base + path)
	if err != nil {
		return "", err
	}
	uq := up.Query()
	for k, v := range params {
		uq.Set(k, v)
	}
	up.RawQuery = uq.Encode()
	return up.String(), nil
}

func proxyToPrometheus(w http.ResponseWriter, r *http.Request, target string) {
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	resp, err := client.Do(req)
	if err != nil {
		writeJSONStatus(w, http.StatusBadGateway, map[string]string{
			"error": "prometheus-unreachable",
			"hint":  "Prometheus is not reachable. Start it with: kubectl -n monitoring port-forward svc/<prometheus-server> <port>:80",
		})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

func (s *SettingsManager) HandlePromQueryRange(w http.ResponseWriter, r *http.Request) {
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	q := r.URL.Query()
	cluster := q.Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	base := set.PrometheusURLFor(cluster)
	if base == "" {
		http.Error(w, fmt.Sprintf("prometheus not configured for %s — set it in Settings", cluster), http.StatusPreconditionFailed)
		return
	}
	for _, k := range []string{"query", "start", "end", "step"} {
		if q.Get(k) == "" {
			http.Error(w, fmt.Sprintf("missing %s", k), http.StatusBadRequest)
			return
		}
	}
	target, err := buildPromURL(base, "/api/v1/query_range", map[string]string{
		"query": q.Get("query"), "start": q.Get("start"), "end": q.Get("end"), "step": q.Get("step"),
	})
	if err != nil {
		http.Error(w, "bad prometheus url", http.StatusInternalServerError)
		return
	}
	proxyToPrometheus(w, r, target)
}

// HandlePromQuery proxies an instant PromQL query (GET /api/prom/query).
// This is the endpoint the innovation backlog flagged as missing — Tier A's
// quantile_over_time(...)-over-a-range recommender is a single instant
// query, not a query_range call, and shelling that through query_range with
// a one-sample window is a needless workaround.
func (s *SettingsManager) HandlePromQuery(w http.ResponseWriter, r *http.Request) {
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	q := r.URL.Query()
	cluster := q.Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	if q.Get("query") == "" {
		http.Error(w, "missing query", http.StatusBadRequest)
		return
	}
	base := set.PrometheusURLFor(cluster)
	if base == "" {
		http.Error(w, fmt.Sprintf("prometheus not configured for %s — set it in Settings", cluster), http.StatusPreconditionFailed)
		return
	}
	params := map[string]string{"query": q.Get("query")}
	if t := q.Get("time"); t != "" {
		params["time"] = t
	}
	target, err := buildPromURL(base, "/api/v1/query", params)
	if err != nil {
		http.Error(w, "bad prometheus url", http.StatusInternalServerError)
		return
	}
	proxyToPrometheus(w, r, target)
}

func writeJSONStatus(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
