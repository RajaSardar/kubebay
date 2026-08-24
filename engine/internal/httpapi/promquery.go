package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	promclient "github.com/prometheus/client_golang/api"
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

	client := &http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, up.String(), nil)
	resp, err := client.Do(req)
	if err != nil {
		wrapped := fmt.Sprintf("prometheus unreachable: %v", err)
		var perr error
		if _, perr = promclient.NewClient(promclient.Config{Address: set.PrometheusURL}); perr == nil {
			wrapped += ""
		}
		http.Error(w, wrapped, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}
