import { matchesSelector, type LabelSelector } from "./labelSelector";

type Obj = Record<string, unknown>;

const HOUR = 60 * 60_000;
const BUCKETS = 12;
const BUCKET_MS = HOUR / BUCKETS;
// Recent enough to call new, or old enough to have gone on all the hour events cover.
const NEW_WITHIN = 15 * 60_000;
const ALL_HOUR_FROM = 55 * 60_000;
// An event repeated thousands of times is spread over this many points, each weighted.
const MAX_POINTS = 1200;

export interface WorkloadWarnings {
  /** Warnings per 5 minutes over the last hour, oldest first. */
  buckets: number[];
  total: number;
  /** The earliest warning in the hour, ms epoch. */
  firstAt: number;
  /** "new": began in the last 15 min; "all hour": began before the hour events cover; else "started". */
  onset: "new" | "started" | "all hour";
}

const rec = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const time = (v: unknown) => {
  const t = Date.parse(str(v));
  return Number.isNaN(t) ? undefined : t;
};

function hasTerms(sel: LabelSelector | undefined): sel is LabelSelector {
  return !!sel && (Object.keys(sel.matchLabels ?? {}).length > 0 || (sel.matchExpressions ?? []).length > 0);
}

/**
 * A workload's warning events over the last hour: on the workload itself, on
 * the pods its selector picks in its namespace and, for a Deployment, on its
 * ReplicaSets. A repeated event (count over its first..last window) is spread
 * across that window. Null when there were none, so nothing renders.
 */
export function workloadWarnings(events: readonly Obj[], pods: readonly Obj[], workload: Obj, now = Date.now()): WorkloadWarnings | null {
  const meta = rec(workload.metadata);
  const name = str(meta.name);
  const ns = str(meta.namespace);
  const kind = str(workload.kind);
  if (!name) return null;

  const selector = rec(rec(workload.spec).selector) as LabelSelector;
  const podNames = new Set<string>();
  if (hasTerms(selector)) {
    for (const p of pods) {
      const pm = rec(p.metadata);
      if (str(pm.namespace) === ns && matchesSelector(rec(pm.labels) as Record<string, string>, selector)) podNames.add(str(pm.name));
    }
  }
  const rsName = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[a-z0-9]+$`);
  const mine = (o: Obj) => {
    if (str(o.namespace) !== ns) return false;
    const k = str(o.kind);
    const n = str(o.name);
    if (k === kind && n === name) return true;
    if (k === "Pod") return podNames.has(n);
    return k === "ReplicaSet" && kind === "Deployment" && rsName.test(n);
  };

  const start = now - HOUR;
  const buckets = new Array<number>(BUCKETS).fill(0);
  let total = 0;
  let firstAt = Infinity;
  const add = (t: number, w: number) => {
    if (t < start) return;
    const i = Math.min(BUCKETS - 1, Math.floor((t - start) / BUCKET_MS));
    buckets[i]! += w;
    total += w;
    firstAt = Math.min(firstAt, t);
  };

  for (const e of events) {
    if (e.type !== "Warning" || !mine(rec(e.involvedObject))) continue;
    const last = time(e.lastTimestamp) ?? time(e.eventTime) ?? time(rec(e.metadata).creationTimestamp);
    if (last === undefined || last < start) continue;
    const count = Math.max(1, Number(e.count) || 1);
    const first = time(e.firstTimestamp);
    // When it was first seen says how long it has gone on, whatever its count;
    // one that began before the hour has gone on all of it.
    if (first !== undefined && first < last) firstAt = Math.min(firstAt, Math.max(first, start));
    if (count === 1 || first === undefined || first >= last) {
      add(last, count);
      continue;
    }
    const n = Math.min(count, MAX_POINTS);
    for (let k = 0; k < n; k++) add(first + ((last - first) * k) / (n - 1), count / n);
  }
  if (total === 0) return null;

  const age = now - firstAt;
  return {
    buckets: buckets.map((b) => Math.round(b)),
    total: Math.round(total),
    firstAt,
    onset: age <= NEW_WITHIN ? "new" : age >= ALL_HOUR_FROM ? "all hour" : "started",
  };
}
