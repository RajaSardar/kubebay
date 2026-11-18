import { matchesSelector, type LabelSelector } from "./labelSelector";
import type { Health, KObj } from "./topology";

/**
 * The Service map: a structural dependency graph built only from objects the
 * app already reads. Every edge says how we know it:
 *   declared  - an object states it (Ingress backend, EndpointSlice, NetworkPolicy)
 *   inferred  - a heuristic (selector fallback, a host named in an env var), with evidence
 *   observed  - measured traffic; never produced here (needs a data plane)
 */
export type EdgeBasis = "declared" | "inferred" | "observed";
export type EdgeKind = "routes-to" | "serves" | "allowed" | "references";

export interface ObjRef {
  slug: string;
  ns: string;
  name: string;
}

export interface MapNode {
  id: string;
  type: "ingress" | "service" | "workload";
  name: string;
  detail: string;
  health: Health;
  ref: ObjRef;
  external?: boolean;
  position: { x: number; y: number };
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  basis: EdgeBasis;
  evidence?: string;
}

export interface ServiceMapInput {
  namespace: string;
  ingresses: KObj[];
  services: KObj[];
  slices: (KObj & { endpoints?: Record<string, unknown>[] })[];
  pods: KObj[];
  replicaSets: KObj[];
  deployments: KObj[];
  statefulSets: KObj[];
  daemonSets: KObj[];
  networkPolicies: KObj[];
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);

const SLUGS: Record<string, string> = {
  Deployment: "deployments",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  ReplicaSet: "replicasets",
  Pod: "pods",
};
const WORKLOADS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);

const COL_X = { ingress: 0, service: 320, workload: 660 };
const ROW_H = 84;

export function buildServiceMap(input: ServiceMapInput): { nodes: MapNode[]; edges: MapEdge[] } {
  const ns = input.namespace;
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();

  const addEdge = (e: Omit<MapEdge, "id">) => {
    const id = `${e.kind}:${e.source}->${e.target}`;
    if (!edges.has(id)) edges.set(id, { id, ...e });
  };
  const addNode = (n: Omit<MapNode, "position">) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, position: { x: COL_X[n.type], y: 0 } });
  };

  // Pod -> workload, through ReplicaSets.
  const rsOwner = new Map<string, string>();
  for (const rs of input.replicaSets) {
    const dep = (rs.metadata?.ownerReferences ?? []).find((o) => o.kind === "Deployment");
    if (dep && rs.metadata?.name) rsOwner.set(rs.metadata.name, dep.name);
  }
  const workloadOf = (pod: KObj): { kind: string; name: string } => {
    const refs = pod.metadata?.ownerReferences ?? [];
    const direct = refs.find((o) => WORKLOADS.has(o.kind));
    if (direct) return { kind: direct.kind, name: direct.name };
    const rs = refs.find((o) => o.kind === "ReplicaSet");
    if (rs) {
      const dep = rsOwner.get(rs.name);
      return dep ? { kind: "Deployment", name: dep } : { kind: "ReplicaSet", name: rs.name };
    }
    return { kind: "Pod", name: pod.metadata?.name ?? "" };
  };
  const wlId = (w: { kind: string; name: string }) => `wl:${w.kind}:${w.name}`;
  const podByName = new Map<string, KObj>();
  for (const p of input.pods) podByName.set(p.metadata?.name ?? "", p);

  // Workload nodes: declared ones, plus any a pod brings (orphan ReplicaSets, bare pods).
  const declared: [string, KObj][] = [
    ...input.deployments.map((d): [string, KObj] => ["Deployment", d]),
    ...input.statefulSets.map((d): [string, KObj] => ["StatefulSet", d]),
    ...input.daemonSets.map((d): [string, KObj] => ["DaemonSet", d]),
  ];
  for (const [kind, w] of declared) {
    const name = w.metadata?.name ?? "";
    const desired = Number(rec(w.spec).replicas ?? (kind === "DaemonSet" ? rec(w.status).desiredNumberScheduled : 1) ?? 1);
    const ready = Number(rec(w.status).readyReplicas ?? rec(w.status).numberReady ?? 0);
    addNode({
      id: wlId({ kind, name }),
      type: "workload",
      name,
      detail: `${kind} · ${ready}/${desired} ready`,
      health: ready >= desired && desired > 0 ? "ok" : ready === 0 ? "err" : "warn",
      ref: { slug: SLUGS[kind]!, ns, name },
    });
  }
  const podWorkloads = new Map<string, { kind: string; name: string }>();
  for (const p of input.pods) {
    const w = workloadOf(p);
    podWorkloads.set(p.metadata?.name ?? "", w);
    addNode({
      id: wlId(w),
      type: "workload",
      name: w.name,
      detail: w.kind,
      health: "idle",
      ref: { slug: SLUGS[w.kind]!, ns, name: w.name },
    });
  }

  // Ingress -> Service (declared).
  const serviceNames = new Set(input.services.map((s) => s.metadata?.name ?? ""));
  const svcId = (n: string, sns = ns) => `svc:${sns}/${n}`;
  const ensureMissingService = (name: string) => {
    if (serviceNames.has(name)) return;
    addNode({ id: svcId(name), type: "service", name, detail: "Service not found", health: "err", ref: { slug: "services", ns, name } });
  };
  for (const ing of input.ingresses) {
    const iname = ing.metadata?.name ?? "";
    const id = `ing:${iname}`;
    addNode({ id, type: "ingress", name: iname, detail: "Ingress", health: "ok", ref: { slug: "ingresses", ns, name: iname } });
    const routes: { svc: string; evidence: string }[] = [];
    const def = rec(rec(rec(ing.spec).defaultBackend).service).name;
    if (typeof def === "string") routes.push({ svc: def, evidence: "default backend" });
    for (const rule of arr(rec(ing.spec).rules)) {
      for (const path of arr(rec(rule.http).paths)) {
        const s = rec(rec(path.backend).service).name;
        if (typeof s === "string") routes.push({ svc: s, evidence: `${(rule.host as string) ?? "*"}${(path.path as string) ?? "/"}` });
      }
    }
    for (const r of routes) {
      ensureMissingService(r.svc);
      addEdge({ source: id, target: svcId(r.svc), kind: "routes-to", basis: "declared", evidence: r.evidence });
    }
  }

  // Services, their ready endpoints, and Service -> workload.
  const slicesBySvc = new Map<string, KObj[]>();
  for (const sl of input.slices) {
    const owner = sl.metadata?.labels?.["kubernetes.io/service-name"];
    if (owner) slicesBySvc.set(owner, [...(slicesBySvc.get(owner) ?? []), sl]);
  }
  for (const svc of input.services) {
    const name = svc.metadata?.name ?? "";
    const id = svcId(name);
    const spec = rec(svc.spec);
    const selector = rec(spec.selector) as Record<string, string>;
    const sliceList = slicesBySvc.get(name);
    let total = 0;
    let ready = 0;
    const targets = new Set<string>();
    if (sliceList) {
      for (const sl of sliceList) {
        for (const ep of arr((sl as Rec).endpoints)) {
          total++;
          if (rec(ep.conditions).ready !== false) ready++;
          const tr = rec(ep.targetRef);
          if (tr.kind === "Pod" && typeof tr.name === "string") {
            const w = podWorkloads.get(tr.name);
            if (w) targets.add(wlId(w));
          }
        }
      }
    }
    let basis: EdgeBasis = "declared";
    if (!sliceList && Object.keys(selector).length > 0) {
      basis = "inferred";
      for (const p of input.pods) {
        if (matchesSelector(p.metadata?.labels ?? {}, { matchLabels: selector })) {
          const w = podWorkloads.get(p.metadata?.name ?? "");
          if (w) targets.add(wlId(w));
          total++;
        }
      }
    }
    const type = (spec.type as string) ?? "ClusterIP";
    const port = arr(spec.ports)[0]?.port;
    const counts = sliceList ? `${ready}/${total} ready` : Object.keys(selector).length ? `${total} pods (selector)` : "no selector";
    addNode({
      id,
      type: "service",
      name,
      detail: `${type}${port != null ? ` :${String(port)}` : ""} · ${counts}`,
      health: sliceList ? (total === 0 || ready === 0 ? "err" : ready < total ? "warn" : "ok") : targets.size ? "ok" : "warn",
      ref: { slug: "services", ns, name },
    });
    for (const t of targets) {
      addEdge({
        source: id,
        target: t,
        kind: "serves",
        basis,
        evidence: basis === "inferred" ? "selector match; no EndpointSlice seen" : undefined,
      });
    }
  }

  // NetworkPolicy allow edges between workloads (same-namespace pod peers only).
  const podsByWl = new Map<string, KObj[]>();
  for (const p of input.pods) {
    const id = wlId(podWorkloads.get(p.metadata?.name ?? "")!);
    podsByWl.set(id, [...(podsByWl.get(id) ?? []), p]);
  }
  const wlMatching = (sel: LabelSelector) =>
    [...podsByWl].filter(([, ps]) => ps.some((p) => matchesSelector(p.metadata?.labels ?? {}, sel))).map(([id]) => id);
  for (const np of input.networkPolicies) {
    const spec = rec(np.spec);
    const types = (spec.policyTypes as string[] | undefined) ?? ["Ingress"];
    if (!types.includes("Ingress")) continue;
    const targets = wlMatching(rec(spec.podSelector) as LabelSelector);
    for (const rule of arr(spec.ingress)) {
      for (const peer of arr(rule.from)) {
        if (!peer.podSelector || peer.namespaceSelector || peer.ipBlock) continue;
        for (const src of wlMatching(peer.podSelector as LabelSelector)) {
          for (const dst of targets) {
            if (src !== dst) addEdge({ source: src, target: dst, kind: "allowed", basis: "declared", evidence: `NetworkPolicy ${np.metadata?.name ?? ""}` });
          }
        }
      }
    }
  }

  // Inferred: workload -> Service from a host named in an env value.
  for (const [kind, w] of declared) {
    const from = wlId({ kind, name: w.metadata?.name ?? "" });
    const template = rec(rec(rec(w.spec).template).spec);
    for (const c of arr(template.containers)) {
      for (const env of arr(c.env)) {
        const value = env.value;
        if (typeof value !== "string") continue;
        const target = serviceFromHost(hostOf(value), ns, serviceNames);
        if (!target) continue;
        const id = svcId(target.name, target.ns);
        if (target.ns !== ns) {
          addNode({ id, type: "service", name: target.name, detail: `in ${target.ns}`, health: "idle", external: true, ref: { slug: "services", ns: target.ns, name: target.name } });
        }
        addEdge({ source: from, target: id, kind: "references", basis: "inferred", evidence: `env ${String(env.name)}=${value}` });
      }
    }
  }

  // Layout: one row per node in its column.
  const rows = { ingress: 0, service: 0, workload: 0 };
  for (const n of nodes.values()) n.position.y = 30 + rows[n.type]++ * ROW_H;
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** The host of "http://u:p@host:80/x", "host:5432" or "host". */
function hostOf(value: string): string {
  let v = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  v = v.split(/[/?#]/)[0] ?? "";
  v = v.slice(v.lastIndexOf("@") + 1);
  return v.replace(/:\d+$/, "").toLowerCase();
}

function serviceFromHost(host: string, ns: string, local: Set<string>): { name: string; ns: string } | null {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*$/.test(host)) return null;
  const parts = host.replace(/\.cluster\.local$/, "").replace(/\.svc$/, "").split(".");
  if (parts.length === 1) return local.has(parts[0]!) ? { name: parts[0]!, ns } : null;
  if (parts.length === 2 && (host.endsWith(".svc") || host.endsWith(".svc.cluster.local") || (parts[1] === ns && local.has(parts[0]!)))) {
    return { name: parts[0]!, ns: parts[1]! };
  }
  return null;
}

export function filterEdges(edges: MapEdge[], show: { inferred: boolean; allowed: boolean }): MapEdge[] {
  return edges.filter((e) => (show.inferred || e.basis !== "inferred") && (show.allowed || e.kind !== "allowed"));
}
