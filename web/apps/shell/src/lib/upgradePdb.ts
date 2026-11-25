import { matchesSelector, type LabelSelector } from "./labelSelector";

// Backlog #80: PodDisruptionBudgets that would stall a node drain. Pure and
// client-side: it reads the PDB and pod streams the app already holds.
type Obj = Record<string, unknown>;
const rec = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** An IntOrString PDB field against the number of matching pods. Percentages round up, as the disruption controller does. */
export function resolveIntOrPercent(v: unknown, total: number): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  const m = /^(\d+)(%?)$/.exec(v.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  return m[2] ? Math.ceil((n * total) / 100) : n;
}

export interface PdbDrainFinding {
  ns: string;
  name: string;
  reason: "no-disruptions" | "single-replica";
  /** Nodes whose drain this PDB would block (they host a protected running pod). */
  nodes: string[];
  workloads: { kind: string; name: string }[];
  podCount: number;
  detail: string;
  suggestion: string;
}

function workloadOf(pod: Obj): { kind: string; name: string } | undefined {
  const o = rec(arr(rec(pod.metadata).ownerReferences)[0]);
  const kind = str(o.kind);
  const name = str(o.name);
  if (!kind || !name) return undefined;
  if (kind === "ReplicaSet") {
    // A Deployment's ReplicaSet is "<deployment>-<pod-template-hash>".
    const m = /^(.+)-[a-z0-9]{5,10}$/.exec(name);
    return m ? { kind: "Deployment", name: m[1]! } : { kind, name };
  }
  return { kind, name };
}

export function pdbDrainBlockers(pdbs: Obj[], pods: Obj[]): PdbDrainFinding[] {
  const running = pods.filter((p) => str(rec(p.status).phase) === "Running");
  const out: PdbDrainFinding[] = [];
  for (const pdb of pdbs) {
    const meta = rec(pdb.metadata);
    const spec = rec(pdb.spec);
    const name = str(meta.name);
    const ns = str(meta.namespace);
    const selector = spec.selector as LabelSelector | undefined;
    // A missing selector matches nothing; an empty one ({}) matches every pod in the namespace.
    if (!name || !selector || typeof selector !== "object") continue;

    const matched = running.filter(
      (p) => str(rec(p.metadata).namespace) === ns && matchesSelector((rec(p.metadata).labels ?? {}) as Record<string, string>, selector),
    );
    if (matched.length === 0) continue;

    // Prefer the controller's own answer; derive it from the spec only when status is missing.
    let allowed = rec(pdb.status).disruptionsAllowed as unknown;
    if (typeof allowed !== "number") {
      const maxUnavailable = resolveIntOrPercent(spec.maxUnavailable, matched.length);
      const minAvailable = resolveIntOrPercent(spec.minAvailable, matched.length);
      if (maxUnavailable !== undefined) allowed = maxUnavailable;
      else if (minAvailable !== undefined) allowed = matched.length - minAvailable;
      else continue;
    }
    if ((allowed as number) > 0) continue;

    const nodes = [...new Set(matched.map((p) => str(rec(p.spec).nodeName)).filter(Boolean))].sort();
    const seen = new Map<string, { kind: string; name: string }>();
    for (const p of matched) {
      const w = workloadOf(p);
      if (w) seen.set(`${w.kind}/${w.name}`, w);
    }
    const single = matched.length === 1;
    const st = rec(pdb.status);
    const unhealthy = typeof st.currentHealthy === "number" && typeof st.desiredHealthy === "number" && st.currentHealthy < st.desiredHealthy;
    out.push({
      ns,
      name,
      reason: single ? "single-replica" : "no-disruptions",
      nodes,
      workloads: [...seen.values()],
      podCount: matched.length,
      detail: unhealthy
        ? `Only ${st.currentHealthy as number} of the ${st.desiredHealthy as number} pods it needs are healthy right now, so it allows 0 disruptions. Some pods are not healthy; fixing them may clear this without changing the budget.`
        : single
        ? "Its one running pod can't be evicted without breaking the budget, so draining its node never finishes."
        : `It allows 0 voluntary disruptions across ${matched.length} running pods, so draining ${nodes.length === 1 ? "that node" : "these nodes"} waits forever.`,
      suggestion: single
        ? "Run at least 2 replicas, or loosen the budget (minAvailable 0 or maxUnavailable 1) before the upgrade."
        : "Loosen the budget (a lower minAvailable, or maxUnavailable of at least 1), or add replicas so one pod can leave at a time.",
    });
  }
  return out.sort((a, b) => `${a.ns}/${a.name}`.localeCompare(`${b.ns}/${b.name}`));
}
