package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

func (s *SettingsManager) HandlePromQueryRange(w http.ResponseWriter, r *http.Request) {
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if set.PrometheusURL == "" {
		http.Error(w, "prometheus not configured — set it in Settings", http.StatusPreconditionFailed)
		return
	}
	q := r.URL.Query()
	for _, k := range []string{"query", "start", "end", "step"} {
		if q.Get(k) == "" {
			http.Error(w, fmt.Sprintf("missing %s", k), http.StatusBadRequest)
			return
		}
	}
	up, err := url.Parse(set.PrometheusURL + "/api/v1/query_range")
	if err != nil {
		http.Error(w, "bad prometheus url", http.StatusInternalServerError)
		return
	}
	uq := up.Query()
	for _, k := range []string{"query", "start", "end", "step"} {
		uq.Set(k, q.Get(k))
	}
	up.RawQuery = uq.Encode()

	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, up.String(), nil)
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

func writeJSONStatus(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
