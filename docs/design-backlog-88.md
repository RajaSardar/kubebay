# Backlog 88: Prometheus metrics missing in every pod (desktop)

Report: the owner's desktop app shows no Prometheus metrics in any pod, while people they
gave Kubebay to see them. Nothing here was run against a real cluster; this is a code
read plus hardening.

## The path

1. Pod Graphs tab: `web/apps/shell/src/components/PodGraphs.tsx` reads settings, then (only
   when no URL is set) `GET /api/prom/status`, then two `GET /api/prom/query_range` calls.
2. Engine: `engine/internal/httpapi/promauto.go` (`promBase`, `autoTarget`, `HandlePromStatus`)
   and `promquery.go` (`HandlePromQueryRange`, `proxyToPrometheus`).
3. Discovery: `engine/internal/prometheus/discover.go` (`Rank`, `Discover`, `Cache`).
4. Settings: `engine/internal/httpapi/settings.go`, `shared_settings.go`
   (`directPromURL`, `promTargetsInForce`).

## Ranked root causes

1. A stale default URL beats auto-detection on every cluster (most likely for the owner).
   `AppSettings.PrometheusURLFor` (`settings.go:67`) falls back to the global
   `prometheusUrl` for any cluster without its own entry, and `directPromURL`
   (`shared_settings.go:88`) returns it before discovery is even tried. `PodGraphs.tsx:36`
   does the same on the client: with any `promUrl` it never asks `/api/prom/status`. A
   default such as `http://localhost:9090` (a port-forward to one cluster, now dead or
   pointing at another cluster) therefore makes every pod in every cluster show
   "Prometheus is not reachable". People who never set a default get auto-detection and
   see graphs. Fix: a per-cluster URL still always wins, but the global default is only a
   fallback for clusters where no Prometheus Service is found.
2. Failures are silent or generic. `discover` drops the discovery error
   (`promauto.go:35`, "Failure is quiet"), `HandlePromStatus` never reports it, and the
   tab shows the plain "History graphs need Prometheus" empty state with no list of what
   was tried. A 403 on `services/proxy` (a user who can list Services but not proxy to
   them, common on EKS with a read-only role) is returned as a raw body and shown as
   "Prometheus query failed -- check URL/reachability" (`PodGraphs.tsx`). Any transport
   error is mapped to `prometheus-unreachable` with a port-forward hint, even when the
   real cause is a 403 or a TLS error (`promquery.go:36`).
3. Discovery misses common installs. `knownNames`/`goodNamespaces` (`discover.go:76-95`)
   do not know VictoriaMetrics (`vmselect`, `vmsingle`), Mimir/Cortex read endpoints
   (`query-frontend`, `nginx` gateway), Grafana Agent/Alloy, or the Managed Prometheus
   frontend; a Service in an unusual namespace is only found when the identity may list
   Services cluster-wide, otherwise only eight namespaces are tried
   (`wellKnownNamespaces`). The fallback list does not include `victoria-metrics`,
   `mimir`, `cattle-monitoring-system`, `kubesphere-monitoring-system`. The tab never tells
   the user which namespaces were tried.
4. Label schemes. The graph queries (`PodGraphs.tsx:57`) require `container!=""` and
   `image!=""`. On clusters whose cAdvisor still exports `pod_name`/`container_name`
   (Kubernetes before 1.16 style relabelling, some managed offerings and old
   kube-prometheus rules), and on runtimes where `image` is empty for some containers,
   the selector matches nothing and the chart is blank without a word. An empty result is
   not reported as such.
5. Negative caching hides a fix. A successful discovery with no match is cached for the
   full five minutes (`promDiscoveryTTL`; only errors use the 30 s negative TTL), so
   installing Prometheus, or granting access, is not noticed until a manual refresh. The
   client keeps its answer for 60 s as well.
6. Per-cluster vs global: pinned Service targets (`PrometheusTargets`) are already stored
   per cluster and a manual URL per cluster (`PrometheusURLs`); only the legacy global
   `prometheusUrl` is shared (cause 1). No migration of stored data is needed, because
   the fix is in resolution order, not in the stored shape.
7. Short ranges. 15m/1h with step 30 s and `rate(...[5m])` returns few or no points for a
   pod younger than the window; this is rendered as an empty chart. Not changed, but an
   empty result now says so.

## Shared-engine locks

Desktop is not affected by `SharedLocked` / `PrometheusAllUsers`: `directPromURL` only
short-circuits to the operator URL when `SharedLocked != ""`, and
`directPromURLForRequest` gates only on a signed-in OIDC identity, which a desktop request
never has. The fix keeps those branches as they were; the new resolution order applies only
to the unlocked, identity-less path. The new test endpoint reads only (GET), goes through
the same impersonating service proxy or the SSRF-guarded client, and never accepts an
arbitrary URL.

## What the fix does

Engine: broader discovery with a report of what was tried and what was forbidden; the
default URL becomes a fallback behind discovery; `GET /api/prom/test` shows the exact URL,
query, HTTP status and a plain cause. Shell: the Graphs tab tolerates both label schemes,
says when Prometheus returned no series, and shows an actionable "not found" panel with
**Choose a Service**, **Enter URL** and **Test connection**; Settings gets the same
test button.

## Not verified

No real cluster, Prometheus or API server proxy was used. Fake Prometheus APIs and a fake
API server (httptest) stand in for them.
