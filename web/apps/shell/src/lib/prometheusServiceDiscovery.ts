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

/**
 * Extract the port from an in-cluster DNS address and suggest a localhost
 * port-forward URL for local Prometheus access.
 *
 * The candidate address is in-cluster format: http://prom.ns.svc:9090
 * This returns the localhost equivalent: http://localhost:9090
 */
export function suggestLocalURL(c: PrometheusServiceCandidate): string {
  // Parse port from address like "http://prom.ns.svc:9090" or "http://prom.ns.svc"
  const url = new URL(c.address);
  const port = url.port || "80";
  return `http://localhost:${port}`;
}

/**
 * Generate the kubectl port-forward command for a Prometheus candidate.
 *
 * Example: "kubectl -n monitoring port-forward svc/prometheus-server 9090:9090"
 */
export function portForwardCommand(c: PrometheusServiceCandidate): string {
  const url = new URL(c.address);
  const port = url.port || "80";
  return `kubectl -n ${c.namespace} port-forward svc/${c.name} ${port}:${port}`;
}
