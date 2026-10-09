function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface PrometheusServiceCandidate {
  namespace: string;
  name: string;
  /** In-cluster DNS address — KEDA resolves this itself, never through Kubebay's local Prometheus proxy. */
  address: string;
}

const PREFERRED_PORT_NAMES = ["web", "http", "http-web"];

function looksLikePrometheus(name: string, labels: Record<string, unknown>): boolean {
  if (name.toLowerCase().includes("prometheus")) return true;
  const appLabel = str(labels["app"]) || str(labels["app.kubernetes.io/name"]);
  return appLabel.toLowerCase().includes("prometheus");
}

function pickPort(ports: Record<string, unknown>[]): number | undefined {
  const named = ports.find((p) => PREFERRED_PORT_NAMES.includes(str(p.name).toLowerCase()));
  const chosen = named ?? ports[0];
  return typeof chosen?.port === "number" ? chosen.port : undefined;
}

/**
 * Backlog #2's own "Prometheus trigger gotcha": KEDA resolves its
 * `serverAddress` in-cluster, which is a different address than whatever
 * Kubebay's local Prometheus proxy (usually a laptop port-forward) is
 * configured with — never prefill one from the other. Instead, scan the
 * already-open Services stream for plausible in-cluster Prometheus
 * candidates by name or `app`/`app.kubernetes.io/name` label, purely as a
 * convenience for the wizard's dropdown; the user still picks (or types
 * their own address).
 */
export function findCandidatePrometheusServices(services: Record<string, unknown>[]): PrometheusServiceCandidate[] {
  const candidates: PrometheusServiceCandidate[] = [];
  for (const svc of services) {
    const meta = rec(svc.metadata);
    const name = str(meta.name);
    const namespace = str(meta.namespace);
    const labels = rec(meta.labels);
    if (!looksLikePrometheus(name, labels)) continue;

    const rawPorts = rec(svc.spec).ports;
    const ports = Array.isArray(rawPorts) ? rawPorts.map(rec) : [];
    const port = pickPort(ports);
    if (port === undefined) continue;

    candidates.push({ namespace, name, address: `http://${name}.${namespace}.svc:${port}` });
  }
  return candidates;
}

// Services a Prometheus chart ships beside the server that don't serve its query API.
const NOT_A_PROMETHEUS_SERVER =
  /(grafana|alertmanager|operator|pushgateway|exporter|kube-state-metrics|adapter|kubelet|coredns|kube-dns|etcd|scheduler|controller-manager|kube-proxy)/i;
const MAX_SHOWN = 4;

function portOf(c: PrometheusServiceCandidate): number {
  const port = new URL(c.address).port;
  return port ? Number(port) : 80;
}

/**
 * The candidates worth offering when the user points Kubebay at a Prometheus:
 * services that serve its query API (not Grafana, Alertmanager, the operator
 * or the exporters a chart installs beside it), the usual port 9090 and
 * Prometheus-named services first, at most four.
 */
export function rankPrometheusServers(candidates: PrometheusServiceCandidate[]): PrometheusServiceCandidate[] {
  const score = (c: PrometheusServiceCandidate) =>
    (portOf(c) === 9090 ? 2 : 0) + (/(^|-)prometheus(-server)?$/.test(c.name) ? 1 : 0);
  return candidates
    .filter((c) => !NOT_A_PROMETHEUS_SERVER.test(c.name))
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, MAX_SHOWN)
    .map(({ c }) => c);
}

/** A port a laptop can bind without root: the service's own, or 9090 for a privileged one. */
function localPortFor(c: PrometheusServiceCandidate): number {
  const port = portOf(c);
  return port < 1024 ? 9090 : port;
}

/**
 * Extract the port from an in-cluster DNS address and suggest a localhost
 * port-forward URL for local Prometheus access.
 *
 * The candidate address is in-cluster format: http://prom.ns.svc:9090
 * This returns the localhost equivalent: http://localhost:9090
 */
export function suggestLocalURL(c: PrometheusServiceCandidate): string {
  return `http://localhost:${localPortFor(c)}`;
}

/**
 * Generate the kubectl port-forward command for a Prometheus candidate.
 *
 * Example: "kubectl -n monitoring port-forward svc/prometheus-server 9090:9090"
 */
export function portForwardCommand(c: PrometheusServiceCandidate): string {
  return `kubectl -n ${c.namespace} port-forward svc/${c.name} ${localPortFor(c)}:${portOf(c)}`;
}
