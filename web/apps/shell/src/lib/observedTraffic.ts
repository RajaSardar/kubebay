import type { MapEdge, MapNode } from "./serviceMap";

/**
 * The Service map's "observed" overlay. It reads request rates from the
 * cluster's Prometheus, but only for metrics whose names and labels are
 * standard to a known data plane. Nothing is guessed: with none of these
 * metrics present the map says so and draws no observed edge.
 *
 *   istio_requests_total              Istio's standard request counter, labelled
 *                                     source_workload / destination_workload and their namespaces
 *   nginx_ingress_controller_requests ingress-nginx's request counter, labelled
 *                                     ingress / namespace / service
 *
 * Cilium/Hubble and Linkerd are not read: their metric and label names are not
 * checked against anything in this repo.
 */
export interface ObservedProbe {
  metric: string;
  /** What the traffic comes from, for the legend. */
  label: string;
  /** Answers with one sample when the metric exists at all. */
  presenceQuery: string;
  /** Request rate by edge for one namespace. Throws on a name that is not a Kubernetes namespace. */
  rateQuery: (ns: string) => string;
  /**
   * Request rate by edge across every namespace, in one query: the same
   * grouping with no namespace matcher, cut to the `cap + 1` busiest series so
   * the caller can tell when there were more than `cap`.
   */
  clusterRateQuery: (cap: number) => string;
}

/** The most series one cluster-wide query draws on the All namespaces map. */
export const OBSERVED_SERIES_CAP = 500;

const NS_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
function safeNs(ns: string): string {
  if (!NS_RE.test(ns)) throw new Error(`not a namespace name: ${ns}`);
  return ns;
}

function safeCap(cap: number): number {
  if (!Number.isInteger(cap) || cap < 1) throw new Error(`not a series cap: ${cap}`);
  return cap;
}

export const OBSERVED_PROBES: ObservedProbe[] = [
  {
    metric: "istio_requests_total",
    label: "Istio",
    presenceQuery: "count(istio_requests_total)",
    rateQuery: (ns) =>
      `sum by (source_workload, source_workload_namespace, destination_workload, destination_workload_namespace) (rate(istio_requests_total{reporter="destination",destination_workload_namespace="${safeNs(ns)}"}[5m]))`,
    clusterRateQuery: (cap) =>
      `topk(${safeCap(cap) + 1}, sum by (source_workload, source_workload_namespace, destination_workload, destination_workload_namespace) (rate(istio_requests_total{reporter="destination"}[5m])))`,
  },
  {
    metric: "nginx_ingress_controller_requests",
    label: "ingress-nginx",
    presenceQuery: "count(nginx_ingress_controller_requests)",
    rateQuery: (ns) => `sum by (ingress, namespace, service) (rate(nginx_ingress_controller_requests{namespace="${safeNs(ns)}"}[5m]))`,
    clusterRateQuery: (cap) => `topk(${safeCap(cap) + 1}, sum by (ingress, namespace, service) (rate(nginx_ingress_controller_requests[5m])))`,
  },
];

export interface PromSample {
  metric: Record<string, string>;
  value: [number, string];
}

export interface ProbeResult {
  probe: ObservedProbe;
  /** The PromQL that produced the samples. */
  query: string;
  /** When it ran, epoch ms. */
  at: number;
  samples: PromSample[];
  /** The cluster-wide query found more series than the cap; only the busiest were kept. */
  truncated?: boolean;
}

/** The `cap` busiest series, and whether any were cut. */
export function capSeries(samples: PromSample[], cap: number): { samples: PromSample[]; truncated: boolean } {
  if (samples.length <= cap) return { samples, truncated: false };
  const rate = (s: PromSample) => {
    const v = Number(s.value?.[1]);
    return Number.isFinite(v) ? v : -Infinity;
  };
  return { samples: [...samples].sort((a, b) => rate(b) - rate(a)).slice(0, cap), truncated: true };
}

/** Observed edges from one probe's samples, only between nodes already on the map and only for a non-zero rate. */
export function observedEdges(res: ProbeResult, ns: string, nodes: MapNode[]): MapEdge[] {
  return edgesFrom(res, nodes, ns);
}

/**
 * Observed edges on the All namespaces map. Each end of a series is matched to
 * a node in the namespace its labels name, so a call from one namespace to
 * another draws a cross-namespace edge. Nodes the node budget dropped are not
 * on the map, so their series draw nothing.
 */
export function observedEdgesAllNamespaces(res: ProbeResult, nodes: MapNode[]): MapEdge[] {
  return edgesFrom(res, nodes);
}

function edgesFrom(res: ProbeResult, nodes: MapNode[], only?: string): MapEdge[] {
  const out = new Map<string, MapEdge>();
  const index = new Map<string, MapNode>();
  for (const n of nodes) {
    // ingress-nginx names an Ingress, never a Gateway or VirtualService drawn in the same column.
    if (n.external || n.type === "group" || (n.type === "ingress" && !n.id.startsWith("ing:"))) continue;
    const k = `${n.type}|${n.ref.ns}|${n.name}`;
    if (!index.has(k)) index.set(k, n);
  }
  const find = (type: MapNode["type"], ns: string | undefined, name: string | undefined) =>
    name && ns && (only === undefined || ns === only) ? index.get(`${type}|${ns}|${name}`) : undefined;
  const add = (source: MapNode | undefined, target: MapNode | undefined, rate: number) => {
    if (!source || !target || !(rate > 0) || !Number.isFinite(rate)) return;
    const id = `traffic:${source.id}->${target.id}`;
    out.set(id, {
      id,
      source: source.id,
      target: target.id,
      kind: "traffic",
      basis: "observed",
      rate,
      observedAt: res.at,
      evidence: `${res.probe.metric}: ${res.query}`,
      crossNamespace: source.ref.ns !== target.ref.ns || undefined,
    });
  };
  for (const s of res.samples) {
    const m = s.metric ?? {};
    const rate = Number(s.value?.[1]);
    if (res.probe.metric === "istio_requests_total") {
      add(find("workload", m.source_workload_namespace, m.source_workload), find("workload", m.destination_workload_namespace, m.destination_workload), rate);
    } else if (res.probe.metric === "nginx_ingress_controller_requests") {
      add(find("ingress", m.namespace, m.ingress), find("service", m.namespace, m.service), rate);
    }
  }
  return [...out.values()];
}
