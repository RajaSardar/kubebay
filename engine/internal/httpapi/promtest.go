package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/RajaSardar/kubebay/engine/internal/prometheus"
)

type promCheck struct {
	Query      string `json:"query"`
	URL        string `json:"url"`
	HTTPStatus int    `json:"httpStatus"`
	Series     int    `json:"series"`
	Error      string `json:"error,omitempty"`
}

type promTestBody struct {
	OK      bool        `json:"ok"`
	Source  string      `json:"source"`
	Target  string      `json:"target,omitempty"`
	Cause   string      `json:"cause,omitempty"`
	Message string      `json:"message"`
	Checks  []promCheck `json:"checks"`
}

// The first query proves Prometheus answers; the second that the kubelet's
// cAdvisor metrics, which every pod graph is built from, are being scraped.
var promTestQueries = []string{`vector(1)`, `count(container_cpu_usage_seconds_total)`}

// HandlePromTest (GET /api/prom/test?cluster=&target=) runs two read-only
// queries against what the graphs would use and reports the exact URL, query
// and HTTP status of each, with a plain cause. target, when given, tests that
// Service instead, through the caller's own service-proxy access; nothing is
// saved. No arbitrary URL is accepted, so this cannot be aimed anywhere new.
func (s *SettingsManager) HandlePromTest(w http.ResponseWriter, r *http.Request) {
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	set, err := s.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var plan promPlan
	if t := strings.TrimSpace(r.URL.Query().Get("target")); t != "" && s.mgr != nil {
		c, err := prometheus.ParseTarget(t)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		base, client, err := s.proxyBase(r.Context(), cluster, c)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		plan = promPlan{source: "auto", base: base, client: client, cand: &c}
	} else {
		plan = s.promPlanFor(r.Context(), set, cluster)
	}
	out := promTestBody{Source: plan.source, Checks: []promCheck{}}
	if plan.source == "none" {
		out.Cause = "none"
		out.Message = "No Prometheus was found for this cluster. Choose a Service or enter a URL."
		writeJSON(w, out)
		return
	}
	if plan.cand != nil {
		out.Target = plan.cand.Target()
	} else {
		out.Target = plan.base
	}
	client := plan.client
	if client == nil {
		client = s.Outbound.Client(10 * time.Second)
	}
	for _, q := range promTestQueries {
		out.Checks = append(out.Checks, s.runPromCheck(r.Context(), client, plan, q))
	}
	out.Cause, out.Message = diagnosePromChecks(plan, out.Checks)
	out.OK = out.Cause == ""
	if out.OK {
		out.Message = "Prometheus answered and has container metrics."
	}
	writeJSON(w, out)
}

func (s *SettingsManager) runPromCheck(ctx context.Context, client *http.Client, plan promPlan, query string) promCheck {
	chk := promCheck{Query: query}
	target, err := buildPromURL(plan.base, "/api/v1/query", map[string]string{"query": query})
	if err != nil {
		chk.Error = err.Error()
		return chk
	}
	chk.URL = target
	if plan.cand != nil { // show the path on the API server, not its address
		if i := strings.Index(target, "/api/v1/namespaces/"); i >= 0 {
			chk.URL = target[i:]
		}
	}
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(cctx, http.MethodGet, target, nil)
	resp, err := client.Do(req)
	if err != nil {
		chk.Error = err.Error()
		return chk
	}
	defer resp.Body.Close()
	chk.HTTPStatus = resp.StatusCode
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var parsed struct {
		Status string `json:"status"`
		Data   struct {
			Result []json.RawMessage `json:"result"`
		} `json:"data"`
	}
	if resp.StatusCode/100 == 2 {
		if err := json.Unmarshal(body, &parsed); err != nil || parsed.Status != "success" {
			chk.Error = "the answer is not a Prometheus query result"
			return chk
		}
		chk.Series = len(parsed.Data.Result)
	}
	return chk
}

func diagnosePromChecks(plan promPlan, checks []promCheck) (cause, message string) {
	first := checks[0]
	switch {
	case first.HTTPStatus == 0 && first.Error != "":
		return "unreachable", "Could not connect: " + first.Error + ". If this is a port-forward, start it again."
	case first.HTTPStatus == http.StatusUnauthorized || first.HTTPStatus == http.StatusForbidden:
		if plan.cand != nil {
			return "forbidden", fmt.Sprintf("Forbidden: your account may not use services/proxy in %s. Ask for get on services/proxy there, or enter a URL instead.", plan.cand.Namespace)
		}
		return "forbidden", "Prometheus refused the request (HTTP " + fmt.Sprint(first.HTTPStatus) + "). Check the URL's credentials or access rules."
	case first.HTTPStatus == http.StatusNotFound:
		return "not-found", "HTTP 404: nothing answers the Prometheus API at that address. Check the Service port, or whether Prometheus runs under a path prefix."
	case first.HTTPStatus == http.StatusServiceUnavailable || first.HTTPStatus == http.StatusBadGateway:
		return "unavailable", fmt.Sprintf("HTTP %d: the Service has no ready pods or does not accept the connection.", first.HTTPStatus)
	case first.Error != "" || first.HTTPStatus/100 != 2:
		msg := first.Error
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", first.HTTPStatus)
		}
		return "bad-response", "Unexpected answer: " + msg
	}
	second := checks[1]
	if second.Error != "" || second.HTTPStatus/100 != 2 {
		return "bad-response", fmt.Sprintf("Prometheus answered, but the container metrics query failed (HTTP %d). %s", second.HTTPStatus, second.Error)
	}
	if second.Series == 0 {
		return "no-container-metrics", "Prometheus answers but has no container_cpu_usage_seconds_total. It is not scraping the kubelet's cAdvisor endpoint (or this is not the Prometheus that does), so pod graphs have nothing to show."
	}
	return "", ""
}
