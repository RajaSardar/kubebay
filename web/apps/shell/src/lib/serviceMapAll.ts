import { buildServiceMap, type MapEdge, type MapFinding, type MapNode, type ServiceMapInput } from "./serviceMap";
import type { KObj } from "./topology";

/** The namespace picker's "All namespaces" value. It is not a valid namespace name, so it never collides with one. */
export const ALL_NAMESPACES = "*all*";

/** The most nodes the all-namespaces map draws before asking the user to narrow it. */
export const ALL_NAMESPACES_BUDGET = 400;

const COL_X = { ingress: 0, service: 320, workload: 660 };
const ROW_H = 84;
const GROUP_GAP = 70;

const nsOf = (o: KObj) => o.metadata?.namespace ?? "";
const bucket = (objs: KObj[] | undefined) => {
  const m = new Map<string, KObj[]>();
  for (const o of objs ?? []) m.set(nsOf(o), [...(m.get(nsOf(o)) ?? []), o]);
  return m;
};

/** Ids that name no namespace get one, so two namespaces' `api` stay two nodes. */
function qualify(id: string, ns: string): string {
  return id.startsWith("wl:") || id.startsWith("ing:") ? `${id.slice(0, id.indexOf(":"))}:${ns}/${id.slice(id.indexOf(":") + 1)}` : id;
}

export interface AllNamespacesMap {
  nodes: MapNode[];
  edges: MapEdge[];
  findings: MapFinding[];
  /** More nodes existed than the budget allows. */
  truncated: boolean;
  /** Nodes before the budget (namespace group headers not counted). */
  total: number;
}

/**
 * One map per namespace, laid out as stacked groups and joined where a
 * reference names a Service in another namespace. Past `budget` nodes the
 * rest are dropped (namespaces in name order) and `truncated` is set.
 */
export function buildAllNamespacesMap(input: Omit<ServiceMapInput, "namespace">, opts: { budget: number }): AllNamespacesMap {
  const buckets = {
    ingresses: bucket(input.ingresses),
    services: bucket(input.services),
    slices: bucket(input.slices),
    pods: bucket(input.pods),
    replicaSets: bucket(input.replicaSets),
    deployments: bucket(input.deployments),
    statefulSets: bucket(input.statefulSets),
    daemonSets: bucket(input.daemonSets),
    networkPolicies: bucket(input.networkPolicies),
    gateways: bucket(input.gateways),
    httpRoutes: bucket(input.httpRoutes),
    grpcRoutes: bucket(input.grpcRoutes),
    virtualServices: bucket(input.virtualServices),
    destinationRules: bucket(input.destinationRules),
  };
  const namespaces = new Set<string>();
  for (const m of Object.values(buckets)) for (const ns of m.keys()) if (ns) namespaces.add(ns);

  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const findings = new Map<string, MapFinding>();
  for (const ns of [...namespaces].sort()) {
    const get = (k: keyof typeof buckets) => (buckets[k].get(ns) ?? []) as KObj[];
    const g = buildServiceMap({
      namespace: ns,
      ingresses: get("ingresses"),
      services: get("services"),
      slices: get("slices") as ServiceMapInput["slices"],
      pods: get("pods"),
      replicaSets: get("replicaSets"),
      deployments: get("deployments"),
      statefulSets: get("statefulSets"),
      daemonSets: get("daemonSets"),
      networkPolicies: get("networkPolicies"),
      gateways: get("gateways"),
      httpRoutes: get("httpRoutes"),
      grpcRoutes: get("grpcRoutes"),
      virtualServices: get("virtualServices"),
      destinationRules: get("destinationRules"),
      // Not bucketed: a grant is read in the namespace a route points into.
      referenceGrants: input.referenceGrants,
      gvrs: input.gvrs,
    });
    const q = (id: string) => qualify(id, ns);
    for (const n of g.nodes) {
      const id = q(n.id);
      const have = nodes.get(id);
      // A reference's stand-in for a Service gives way to the Service's own node.
      if (have && !(have.external && !n.external)) continue;
      nodes.set(id, { ...n, id, group: n.external ? have?.group ?? n.ref.ns : ns });
    }
    for (const e of g.edges) {
      const source = q(e.source);
      const target = q(e.target);
      const id = `${e.kind}:${source}->${target}`;
      if (!edges.has(id)) edges.set(id, { ...e, id, source, target });
    }
    for (const f of g.findings) findings.set(`${f.kind}:${q(f.nodeId)}`, { ...f, nodeId: q(f.nodeId) });
  }

  // An external stand-in whose real namespace was never listed still needs a group.
  const all = [...nodes.values()].sort((a, b) => (a.group ?? "").localeCompare(b.group ?? ""));
  const total = all.length;
  const kept = all.slice(0, Math.max(0, opts.budget));
  const keptIds = new Set(kept.map((n) => n.id));

  // Layout: a header row per namespace, then one row per node in its column.
  const groups = [...new Set(kept.map((n) => n.group ?? ""))];
  const out: MapNode[] = [];
  let y = 0;
  for (const grp of groups) {
    out.push({
      id: `group:${grp}`,
      type: "group",
      name: grp,
      detail: "namespace",
      health: "idle",
      ref: { slug: "namespaces", ns: "", name: grp },
      group: grp,
      position: { x: 0, y },
    });
    y += ROW_H * 0.7;
    const rows = { ingress: 0, service: 0, workload: 0 };
    for (const n of kept.filter((k) => (k.group ?? "") === grp)) {
      const t = n.type as keyof typeof rows;
      out.push({ ...n, position: { x: COL_X[t], y: y + rows[t]++ * ROW_H } });
    }
    y += Math.max(1, ...Object.values(rows)) * ROW_H + GROUP_GAP;
  }

  return {
    nodes: out,
    edges: [...edges.values()].filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
    findings: [...findings.values()].filter((f) => keptIds.has(f.nodeId)),
    truncated: total > kept.length,
    total,
  };
}
