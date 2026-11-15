import { matchesSelector, type LabelSelector, type MatchExpression } from "./labelSelector";
import { controllerOwner } from "./podOwner";
import { parseCpuMillis, parseMemBytes } from "./rightsizing";
import { findSingleReplicaNoPdb, type WorkloadEntry } from "./spof";

/**
 * Intelligence roadmap Tier 2 #15: a read-only node consolidation view.
 * For each node, would its pods fit on the rest of the cluster by requests,
 * and what would stop a drain? Gated by SPOF Radar (#24): a node holding a
 * single-replica workload with no PDB is "drain causes downtime", never
 * plain "drainable". Kubebay never cordons or drains anything here.
 *
 * Placement is a first-fit-decreasing simulation by requests that honours
 * nodeSelector, required node affinity and NoSchedule/NoExecute taints.
 * Inter-pod (anti-)affinity and host ports aren't simulated: a pod with a
 * required one is reported as a constraint rather than guessed at.
 */

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(rec(v))) if (typeof x === "string") out[k] = x;
  return out;
}

export type ConsolidationBlocker =
  | { kind: "no-room"; ns: string; pod: string }
  | { kind: "bare-pod"; ns: string; pod: string }
  | { kind: "pdb"; ns: string; pod: string; pdb: string }
  | { kind: "constrained"; ns: string; pod: string };

export interface SpofOnNode {
  ns: string;
  name: string;
  workloadKind: string;
}

export interface NodeConsolidation {
  node: string;
  outcome: "drainable" | "downtime" | "blocked" | "skipped";
  skipReason?: string;
  allocatableCpuMillis: number;
  allocatableMemBytes: number;
  requestedCpuMillis: number;
  requestedMemBytes: number;
  podsToMove: number;
  blockers: ConsolidationBlocker[];
  spof: SpofOnNode[];
}

export interface ConsolidationResult {
  nodes: NodeConsolidation[];
  /** Nodes that could be drained one after another with no blocker and no SPOF downtime. */
  drainable: string[];
}

interface NodeInfo {
  name: string;
  labels: Record<string, string>;
  taints: Obj[];
  allocCpu: number;
  allocMem: number;
  reqCpu: number;
  reqMem: number;
  receives: boolean;
  skipReason?: string;
}

interface MovablePod {
  ns: string;
  name: string;
  obj: Obj;
  cpu: number;
  mem: number;
}

function podRequests(p: Obj): { cpu: number; mem: number } {
  let cpu = 0;
  let mem = 0;
  for (const c of arr(rec(p.spec).containers)) {
    const r = rec(rec(rec(c).resources).requests);
    cpu += parseCpuMillis(str(r.cpu) || undefined);
    mem += parseMemBytes(str(r.memory) || undefined);
  }
  return { cpu, mem };
}

function isTerminal(p: Obj): boolean {
  const phase = str(rec(p.status).phase);
  return phase === "Succeeded" || phase === "Failed";
}

function stays(p: Obj): boolean {
  if (controllerOwner(p)?.kind === "DaemonSet") return true;
  return !!rec(rec(p.metadata).annotations)["kubernetes.io/config.mirror"];
}

function tolerates(pod: Obj, taint: Obj): boolean {
  return arr(rec(pod.spec).tolerations).some((t) => {
    const tol = rec(t);
    const key = str(tol.key);
    const op = str(tol.operator) || "Equal";
    if (tol.effect && tol.effect !== taint.effect) return false;
    if (!key) return op === "Exists";
    if (key !== str(taint.key)) return false;
    return op === "Exists" || str(tol.value) === str(taint.value);
  });
}

function exprMatches(labels: Record<string, string>, e: MatchExpression): boolean {
  if (e.operator === "Gt" || e.operator === "Lt") {
    const v = Number(labels[e.key]);
    const bound = Number((e.values ?? [])[0]);
    if (!(e.key in labels) || Number.isNaN(v) || Number.isNaN(bound)) return false;
    return e.operator === "Gt" ? v > bound : v < bound;
  }
  return matchesSelector(labels, { matchExpressions: [e] });
}

function fitsOn(pod: Obj, n: NodeInfo): boolean {
  const spec = rec(pod.spec);
  if (!matchesSelector(n.labels, { matchLabels: strMap(spec.nodeSelector) })) return false;
  const terms = arr(rec(rec(rec(spec.affinity).nodeAffinity).requiredDuringSchedulingIgnoredDuringExecution).nodeSelectorTerms);
  if (terms.length > 0) {
    const ok = terms.some((t) => {
      const term = rec(t);
      const exprs = arr(term.matchExpressions) as MatchExpression[];
      const fields = arr(term.matchFields) as MatchExpression[];
      return exprs.every((e) => exprMatches(n.labels, e)) && fields.every((e) => exprMatches({ "metadata.name": n.name }, e));
    });
    if (!ok) return false;
  }
  return n.taints.every((t) => {
    const effect = str(t.effect);
    return (effect !== "NoSchedule" && effect !== "NoExecute") || tolerates(pod, t);
  });
}

function isConstrained(pod: Obj): boolean {
  const spec = rec(pod.spec);
  const aff = rec(spec.affinity);
  const required = (k: string) => arr(rec(aff[k]).requiredDuringSchedulingIgnoredDuringExecution).length > 0;
  if (required("podAntiAffinity") || required("podAffinity")) return true;
  return arr(spec.containers).some((c) => arr(rec(c).ports).some((p) => typeof rec(p).hostPort === "number"));
}

/**
 * Places pods onto targets first-fit-decreasing, adding to the targets'
 * requested totals. Returns where each pod landed and the pods that fit nowhere.
 */
function place(pods: MovablePod[], targets: NodeInfo[]): { landed: Map<MovablePod, string>; unplaced: MovablePod[] } {
  const landed = new Map<MovablePod, string>();
  const unplaced: MovablePod[] = [];
  for (const p of [...pods].sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)) {
    const t = targets.find((n) => n.allocCpu - n.reqCpu >= p.cpu && n.allocMem - n.reqMem >= p.mem && fitsOn(p.obj, n));
    if (!t) {
      unplaced.push(p);
      continue;
    }
    t.reqCpu += p.cpu;
    t.reqMem += p.mem;
    landed.set(p, t.name);
  }
  return { landed, unplaced };
}

export function assessConsolidation(input: {
  nodes: Obj[];
  pods: Obj[];
  pdbs: Obj[];
  deployments: Obj[];
  statefulSets: Obj[];
}): ConsolidationResult {
  const infos: NodeInfo[] = input.nodes.map((n) => {
    const meta = rec(n.metadata);
    const labels = strMap(meta.labels);
    const alloc = rec(rec(n.status).allocatable);
    const ready = arr(rec(n.status).conditions).some((c) => rec(c).type === "Ready" && rec(c).status === "True");
    const cordoned = rec(n.spec).unschedulable === true;
    const skipReason = !ready
      ? "not Ready"
      : cordoned
        ? "already cordoned"
        : "node-role.kubernetes.io/control-plane" in labels || "node-role.kubernetes.io/master" in labels
          ? "control plane"
          : undefined;
    return {
      name: str(meta.name),
      labels,
      taints: arr(rec(n.spec).taints).map(rec),
      allocCpu: parseCpuMillis(str(alloc.cpu) || undefined),
      allocMem: parseMemBytes(str(alloc.memory) || undefined),
      reqCpu: 0,
      reqMem: 0,
      receives: ready && !cordoned,
      skipReason,
    };
  });
  const byName = new Map(infos.map((i) => [i.name, i]));

  const movable = new Map<string, MovablePod[]>();
  for (const p of input.pods) {
    const nodeName = str(rec(p.spec).nodeName);
    const info = byName.get(nodeName);
    if (!info || isTerminal(p)) continue;
    const { cpu, mem } = podRequests(p);
    info.reqCpu += cpu;
    info.reqMem += mem;
    if (stays(p)) continue;
    const meta = rec(p.metadata);
    movable.set(nodeName, [...(movable.get(nodeName) ?? []), { ns: str(meta.namespace), name: str(meta.name), obj: p, cpu, mem }]);
  }

  // SPOF Radar's single-replica-no-PDB finding, joined to the pods it covers.
  const workloads: WorkloadEntry[] = [
    ...input.deployments.map((obj) => ({ kind: "Deployment", obj })),
    ...input.statefulSets.map((obj) => ({ kind: "StatefulSet", obj })),
  ];
  const spofs = findSingleReplicaNoPdb(workloads, input.pdbs).map((f) => {
    const w = workloads.find((x) => x.kind === f.workloadKind && str(rec(x.obj.metadata).namespace) === f.ns && str(rec(x.obj.metadata).name) === f.name);
    return { f, selector: rec(rec(w?.obj.spec).selector) as LabelSelector };
  });
  const blockingPdbs = input.pdbs.filter((b) => rec(b.status).disruptionsAllowed === 0);

  const clone = (exclude: Set<string>) =>
    infos.filter((i) => i.receives && !exclude.has(i.name)).map((i) => ({ ...i }));

  function assess(node: NodeInfo, targets: NodeInfo[]) {
    const pods = movable.get(node.name) ?? [];
    const blockers: ConsolidationBlocker[] = [];
    const spof: SpofOnNode[] = [];
    const toPlace: MovablePod[] = [];
    for (const p of pods) {
      const labels = strMap(rec(p.obj.metadata).labels);
      if (!controllerOwner(p.obj)) blockers.push({ kind: "bare-pod", ns: p.ns, pod: p.name });
      const pdb = blockingPdbs.find(
        (b) => str(rec(b.metadata).namespace) === p.ns && matchesSelector(labels, rec(rec(b.spec).selector) as LabelSelector),
      );
      if (pdb) blockers.push({ kind: "pdb", ns: p.ns, pod: p.name, pdb: str(rec(pdb.metadata).name) });
      for (const s of spofs) {
        if (s.f.ns === p.ns && matchesSelector(labels, s.selector) && !spof.some((x) => x.ns === s.f.ns && x.name === s.f.name)) {
          spof.push({ ns: s.f.ns, name: s.f.name, workloadKind: s.f.workloadKind });
        }
      }
      if (isConstrained(p.obj)) blockers.push({ kind: "constrained", ns: p.ns, pod: p.name });
      else toPlace.push(p);
    }
    const { landed, unplaced } = place(toPlace, targets);
    for (const p of unplaced) blockers.push({ kind: "no-room", ns: p.ns, pod: p.name });
    return { podsToMove: pods.length, blockers, spof, landed };
  }

  const outcomeOf = (r: { blockers: unknown[]; spof: unknown[] }): NodeConsolidation["outcome"] =>
    r.blockers.length > 0 ? "blocked" : r.spof.length > 0 ? "downtime" : "drainable";

  const nodes: NodeConsolidation[] = infos.map((i) => {
    const base = {
      node: i.name,
      allocatableCpuMillis: i.allocCpu,
      allocatableMemBytes: i.allocMem,
      requestedCpuMillis: i.reqCpu,
      requestedMemBytes: i.reqMem,
    };
    if (i.skipReason) return { ...base, outcome: "skipped", skipReason: i.skipReason, podsToMove: 0, blockers: [], spof: [] };
    const { podsToMove, blockers, spof } = assess(i, clone(new Set([i.name])));
    return { ...base, podsToMove, blockers, spof, outcome: outcomeOf({ blockers, spof }) };
  });

  // Greedy: emptiest node first. A drained node's pods stay on the nodes they
  // landed on, so the next candidate is judged against that fuller cluster.
  const util = (i: NodeInfo) => Math.max(i.allocCpu ? i.reqCpu / i.allocCpu : 1, i.allocMem ? i.reqMem / i.allocMem : 1);
  const removed = new Set<string>();
  let state = clone(removed);
  for (const cand of infos.filter((i) => !i.skipReason).sort((a, b) => util(a) - util(b) || a.name.localeCompare(b.name))) {
    const cur = state.find((s) => s.name === cand.name);
    if (!cur) continue;
    const targets = state.filter((s) => s.name !== cand.name).map((s) => ({ ...s }));
    const r = assess(cur, targets);
    if (outcomeOf(r) !== "drainable") continue;
    removed.add(cand.name);
    state = targets;
    movable.set(cand.name, []);
    for (const [p, to] of r.landed) movable.set(to, [...(movable.get(to) ?? []), p]);
  }

  return { nodes, drainable: [...removed] };
}
