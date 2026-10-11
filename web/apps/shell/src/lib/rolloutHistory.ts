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
  /** The current revision: the highest one among the Deployment's ReplicaSets. */
  revision: number;
  /** When the current revision rolled out: its ReplicaSet's creation. Absent
   *  for a rollback, whose ReplicaSet was created long before it was current. */
  since?: string;
  /** The current ReplicaSet was rolled back to (it held earlier revisions). */
  rollback: boolean;
  /** Revision 1: never rolled out since the Deployment was created. */
  first: boolean;
  /** Rollouts in the last 7 days, rollbacks included; creating the Deployment isn't one. */
  rolloutsThisWeek: number;
  /** The count is a lower bound: undated revisions may also fall in the week. */
  atLeast: boolean;
}

/**
 * Overview v2, in a Deployment's drawer: how old the current revision is and
 * how many rollouts happened in the last 7 days, from the ReplicaSets the
 * cluster keeps (no recording). Every rollout, a rollback included, takes the
 * next revision number, so revisions are assigned in order. A ReplicaSet's
 * creation dates the revision it was created with (the first in its
 * revision-history, or its revision), and revision 1 is the Deployment's
 * creation. The week's rollouts are the revisions after the last one dated
 * before the week; ReplicaSets pruned by revisionHistoryLimit leave a gap,
 * which makes the count a lower bound. Null when no owned ReplicaSet carries
 * a revision.
 */
export function rolloutHistory(
  deployment: Record<string, unknown>,
  replicaSets: Record<string, unknown>[],
  now = Date.now(),
): RolloutHistory | null {
  const meta = rec(deployment.metadata);
  const uid = str(meta.uid);
  if (!uid) return null;

  let current: { revision: number; created: string; history: number[] } | null = null;
  // Revision number → when it was assigned, for the revisions we can date.
  const dated = new Map<number, number>();
  const created = Date.parse(str(meta.creationTimestamp));
  if (!Number.isNaN(created)) dated.set(1, created);

  for (const r of replicaSets) {
    const m = rec(r.metadata);
    const owned = Array.isArray(m.ownerReferences) && m.ownerReferences.some((o) => str(rec(o).uid) === uid);
    if (!owned) continue;
    const a = rec(m.annotations);
    const revision = parseInt(str(a[REVISION]), 10) || 0;
    if (revision <= 0) continue;
    const history = str(a[REVISION_HISTORY])
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => n > 0);
    const at = Date.parse(str(m.creationTimestamp));
    if (!Number.isNaN(at)) dated.set(Math.min(revision, ...history), at);
    if (!current || revision > current.revision) current = { revision, created: str(m.creationTimestamp), history };
  }
  if (!current) return null;

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

  const rollback = current.history.length > 0;
  return {
    revision: current.revision,
    since: rollback ? undefined : current.created || undefined,
    rollback,
    first: current.revision === 1,
    rolloutsThisWeek: least,
    atLeast: least !== most,
  };
}
