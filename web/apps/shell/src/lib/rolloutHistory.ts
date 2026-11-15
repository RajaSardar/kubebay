const REVISION = "deployment.kubernetes.io/revision";
const REVISION_HISTORY = "deployment.kubernetes.io/revision-history";
const WEEK = 7 * 24 * 60 * 60_000;

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface RolloutHistory {
  /** The current revision: the highest one the workload's history keeps. */
  revision: number;
  /** When the current revision rolled out. Absent for a Deployment's
   *  rollback, whose ReplicaSet was created long before it was current. */
  since?: string;
  /** The current revision was rolled back to: an earlier template took it. */
  rollback: boolean;
  /** Revision 1: never rolled out since the workload was created. */
  first: boolean;
  /** Rollouts in the last 7 days, rollbacks included; creating the workload isn't one. */
  rolloutsThisWeek: number;
  /** The count is a lower bound: undated revisions may also fall in the week. */
  atLeast: boolean;
}

/** One kept revision: a ReplicaSet or a ControllerRevision. */
interface Kept {
  revision: number;
  created: string;
  /** When its current revision was assigned, if known. */
  set?: string;
  /** The revision it was created with, when it can be told. */
  createdAs?: number;
  rollback: boolean;
}

/** A ControllerRevision is changed only to bump its revision on a rollback,
 *  so its newest managedFields time is when that revision was set. */
function lastWrite(m: Record<string, unknown>): string {
  let best = "";
  for (const f of Array.isArray(m.managedFields) ? m.managedFields : []) {
    const t = str(rec(f).time);
    if (t && (!best || Date.parse(t) > Date.parse(best))) best = t;
  }
  return best;
}

/** Writes this close to creation are the creation itself. */
const SAME_WRITE = 10_000;

function keptRevisions(kind: string, uid: string, objs: Record<string, unknown>[]): Kept[] {
  const owned = objs
    .map((o) => ({ o, m: rec(o.metadata) }))
    .filter(({ m }) => Array.isArray(m.ownerReferences) && m.ownerReferences.some((r) => str(rec(r).uid) === uid));
  if (kind === "StatefulSet" || kind === "DaemonSet") {
    const out: Kept[] = [];
    for (const { o, m } of owned) {
      const revision = typeof o.revision === "number" ? o.revision : 0;
      if (revision <= 0) continue;
      const created = str(m.creationTimestamp);
      const set = lastWrite(m);
      // Bumped since its creation: it was rolled back to. Without
      // managedFields, a revision created after it says the same.
      const bumped = set
        ? Date.parse(set) - Date.parse(created) > SAME_WRITE
        : owned.some(({ o: p, m: n }) => p !== o && Date.parse(str(n.creationTimestamp)) > Date.parse(created) && (typeof p.revision === "number" ? p.revision : 0) < revision);
      out.push({ revision, created, set: set || (bumped ? undefined : created), createdAs: bumped ? undefined : revision, rollback: bumped });
    }
    return out;
  }
  const out: Kept[] = [];
  for (const { m } of owned) {
    const a = rec(m.annotations);
    const revision = parseInt(str(a[REVISION]), 10) || 0;
    if (revision <= 0) continue;
    const history = str(a[REVISION_HISTORY])
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => n > 0);
    const created = str(m.creationTimestamp);
    // A ReplicaSet is also written on every scale, so only an untouched
    // revision (no history) is dated, by its creation.
    out.push({ revision, created, set: history.length ? undefined : created, createdAs: Math.min(revision, ...history), rollback: history.length > 0 });
  }
  return out;
}

/**
 * Overview v2, in a workload's drawer: how old the current revision is and
 * how many rollouts happened in the last 7 days, from the history the cluster
 * keeps (no recording): a Deployment's ReplicaSets, a StatefulSet's or
 * DaemonSet's ControllerRevisions. Every rollout, a rollback included, takes
 * the next revision number, so revisions are assigned in order. A revision is
 * dated by the creation of what was created with it (for a ReplicaSet, the
 * first in its revision-history, or its revision), or by when a
 * ControllerRevision's revision was last set; revision 1 is the workload's
 * creation. The week's rollouts are the revisions after the last one dated
 * before the week; revisions pruned by revisionHistoryLimit leave a gap, which
 * makes the count a lower bound. Null when nothing owned carries a revision.
 */
export function rolloutHistory(
  workload: Record<string, unknown>,
  history: Record<string, unknown>[],
  now = Date.now(),
): RolloutHistory | null {
  const meta = rec(workload.metadata);
  const uid = str(meta.uid);
  if (!uid) return null;
  const kept = keptRevisions(str(workload.kind), uid, history);
  if (kept.length === 0) return null;
  const current = kept.reduce((a, b) => (b.revision > a.revision ? b : a));

  // Revision number → when it was assigned, for the revisions we can date.
  const dated = new Map<number, number>();
  const created = Date.parse(str(meta.creationTimestamp));
  if (!Number.isNaN(created)) dated.set(1, created);
  for (const k of kept) {
    const at = Date.parse(k.created);
    if (k.createdAs !== undefined && !Number.isNaN(at)) dated.set(k.createdAs, at);
    const set = k.set ? Date.parse(k.set) : NaN;
    if (!Number.isNaN(set)) dated.set(k.revision, set);
  }

  // The last revision assigned before the week is at least the newest one
  // dated before it, and below the oldest one dated inside it.
  const start = now - WEEK;
  let before = 0;
  let inside = current.revision + 1;
  for (const [k, at] of dated) {
    if (at < start) before = Math.max(before, k);
    else inside = Math.min(inside, k);
  }
  const most = current.revision - Math.max(before, 1);
  const least = Math.min(most, Math.max(0, current.revision - Math.max(inside - 1, 1)));

  return {
    revision: current.revision,
    since: current.set || undefined,
    rollback: current.rollback,
    first: current.revision === 1,
    rolloutsThisWeek: least,
    atLeast: least !== most,
  };
}
