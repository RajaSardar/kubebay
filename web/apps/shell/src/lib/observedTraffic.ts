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
}

const NS_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
function safeNs(ns: string): string {
  if (!NS_RE.test(ns)) throw new Error(`not a namespace name: ${ns}`);
  return ns;
}

export const OBSERVED_PROBES: ObservedProbe[] = [
  {
    metric: "istio_requests_total",
    label: "Istio",
    presenceQuery: "count(istio_requests_total)",
    rateQuery: (ns) =>
      `sum by (source_workload, source_workload_namespace, destination_workload, destination_workload_namespace) (rate(istio_requests_total{reporter="destination",destination_workload_namespace="${safeNs(ns)}"}[5m]))`,
  },
  {
    metric: "nginx_ingress_controller_requests",
    label: "ingress-nginx",
    presenceQuery: "count(nginx_ingress_controller_requests)",
    rateQuery: (ns) => `sum by (ingress, namespace, service) (rate(nginx_ingress_controller_requests{namespace="${safeNs(ns)}"}[5m]))`,
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
}

/** Observed edges from one probe's samples, only between nodes already on the map and only for a non-zero rate. */
export function observedEdges(res: ProbeResult, ns: string, nodes: MapNode[]): MapEdge[] {
  const out = new Map<string, MapEdge>();
  const here = (n: MapNode) => n.ref.ns === ns && !n.external;
  const find = (type: MapNode["type"], name: string | undefined) => (name ? nodes.find((n) => n.type === type && n.name === name && here(n)) : undefined);
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
    });
  };
  for (const s of res.samples) {
    const m = s.metric;
    const rate = Number(s.value?.[1]);
    if (res.probe.metric === "istio_requests_total") {
      if (m.source_workload_namespace !== ns || m.destination_workload_namespace !== ns) continue;
      add(find("workload", m.source_workload), find("workload", m.destination_workload), rate);
    } else if (res.probe.metric === "nginx_ingress_controller_requests") {
      if (m.namespace !== ns) continue;
      add(find("ingress", m.ingress), find("service", m.service), rate);
    }
  }
  return [...out.values()];
}
