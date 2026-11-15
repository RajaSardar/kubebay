import type { AttentionRow } from "./attention";
import { holdsRoom, podRequests } from "./capacity";

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return (v ?? {}) as Obj;
}

export interface NamespaceRank {
  namespace: string;
  pods: number;
  /** Pods in this namespace on the Needs attention list. */
  broken: number;
  /** Warning events in the last hour. */
  warnings: number;
  cpuRequested: number;
  memRequested: number;
  /** This namespace's share of all CPU requested, whole percent. */
  cpuShare: number;
}

const HOUR = 60 * 60_000;
const TOP = 10;

/**
 * Overview v2, below the fold: the ten namespaces that most need a look — by
 * broken pods, then warnings in the last hour ("which team do I ping?"), or
 * by CPU requested ("who holds the room?").
 */
export function rankNamespaces(input: {
  pods: Obj[];
  attention: AttentionRow[];
  events: Obj[];
  by: "problems" | "requests";
  now?: number;
}): NamespaceRank[] {
  const now = input.now ?? Date.now();
  const by = new Map<string, NamespaceRank>();
  const get = (ns: string) => {
    let r = by.get(ns);
    if (!r) by.set(ns, (r = { namespace: ns, pods: 0, broken: 0, warnings: 0, cpuRequested: 0, memRequested: 0, cpuShare: 0 }));
    return r;
  };

  for (const p of input.pods) {
    const meta = rec(p.metadata);
    if (meta.deletionTimestamp || rec(p.status).phase === "Succeeded") continue;
    const r = get(String(meta.namespace ?? ""));
    r.pods++;
    if (holdsRoom(p)) {
      const req = podRequests(p);
      r.cpuRequested += req.cpu;
      r.memRequested += req.memory;
    }
  }
  for (const a of input.attention) get(a.namespace).broken += a.pods.length;
  for (const e of input.events) {
    if (e.type !== "Warning") continue;
    const t = Date.parse(String(e.lastTimestamp ?? e.eventTime ?? rec(e.metadata).creationTimestamp ?? ""));
    if (Number.isNaN(t) || t < now - HOUR || t > now) continue;
    get(String(rec(e.metadata).namespace ?? rec(e.involvedObject).namespace ?? "")).warnings += typeof e.count === "number" && e.count > 0 ? e.count : 1;
  }

  const rows = [...by.values()].filter((r) => r.namespace);
  const totalCpu = rows.reduce((n, r) => n + r.cpuRequested, 0);
  for (const r of rows) r.cpuShare = totalCpu > 0 ? Math.round((r.cpuRequested / totalCpu) * 100) : 0;

  rows.sort(
    input.by === "requests"
      ? (a, b) => b.cpuRequested - a.cpuRequested || b.memRequested - a.memRequested || a.namespace.localeCompare(b.namespace)
      : (a, b) => b.broken - a.broken || b.warnings - a.warnings || b.pods - a.pods || a.namespace.localeCompare(b.namespace),
  );
  return rows.slice(0, TOP);
}
