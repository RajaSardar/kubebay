/**
 * Resource Timeline (Intelligence roadmap Tier 2 #18): one time-ordered view
 * of what happened to a workload, merged from objects Kubebay already
 * streams. No AI and no inference, just the cluster's own records:
 * - Events on the workload, its ReplicaSets and its pods
 * - rollout revisions (a Deployment's ReplicaSets and their images)
 * - condition transitions on the workload
 * - container terminations from pods' last state (OOMKilled, Error, …)
 * Kubernetes keeps Events for about an hour by default, so older entries
 * come only from revisions, conditions and last states.
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

export interface TimelineEntry {
  at: string;
  source: "event" | "rollout" | "condition" | "container";
  severity: "normal" | "warning";
  /** Kind/name of the object the entry is about. */
  subject: string;
  title: string;
  detail: string;
}

const REVISION = "deployment.kubernetes.io/revision";
const HEALTH_CONDITIONS = new Set(["Available", "Ready", "ContainersReady", "PodScheduled", "Initialized", "Complete"]);

function ownedBy(o: Obj, uid: string): boolean {
  return !!uid && arr(rec(o.metadata).ownerReferences).some((r) => rec(r).uid === uid);
}

export function buildTimeline(input: { obj: Obj; events: Obj[]; replicaSets: Obj[]; pods: Obj[] }): TimelineEntry[] {
  const meta = rec(input.obj.metadata);
  const kind = str(input.obj.kind);
  const ns = str(meta.namespace);
  const uid = str(meta.uid);
  const out: TimelineEntry[] = [];

  const ownRs = kind === "Deployment" ? input.replicaSets.filter((r) => ownedBy(r, uid)) : [];
  const rsUids = new Set(ownRs.map((r) => str(rec(r.metadata).uid)));
  const pods =
    kind === "Pod"
      ? [input.obj]
      : input.pods.filter((p) => ownedBy(p, uid) || arr(rec(p.metadata).ownerReferences).some((r) => rsUids.has(str(rec(r).uid))));

  const subjects = new Set<string>([`${kind}/${str(meta.name)}`]);
  for (const r of ownRs) subjects.add(`ReplicaSet/${str(rec(r.metadata).name)}`);
  for (const p of pods) subjects.add(`Pod/${str(rec(p.metadata).name)}`);

  for (const e of input.events) {
    const inv = rec(e.involvedObject);
    const subject = `${str(inv.kind)}/${str(inv.name)}`;
    if (!subjects.has(subject) || (ns && str(inv.namespace) !== ns)) continue;
    const at = str(e.lastTimestamp) || str(e.eventTime) || str(e.firstTimestamp) || str(rec(e.metadata).creationTimestamp);
    if (!at) continue;
    const count = typeof e.count === "number" ? e.count : 1;
    out.push({
      at,
      source: "event",
      severity: str(e.type) === "Normal" ? "normal" : "warning",
      subject,
      title: str(e.reason) || "Event",
      detail: `${str(e.message)}${count > 1 ? ` (×${count})` : ""}`,
    });
  }

  for (const r of ownRs) {
    const m = rec(r.metadata);
    const at = str(m.creationTimestamp);
    if (!at) continue;
    const images = arr(rec(rec(rec(r.spec).template).spec).containers)
      .map((c) => `${str(rec(c).name)}=${str(rec(c).image)}`)
      .join(", ");
    const rev = str(rec(m.annotations)[REVISION]);
    out.push({
      at,
      source: "rollout",
      severity: "normal",
      subject: `ReplicaSet/${str(m.name)}`,
      title: rev ? `Revision ${rev}` : "New ReplicaSet",
      detail: images,
    });
  }

  for (const c of arr(rec(input.obj.status).conditions)) {
    const cond = rec(c);
    const at = str(cond.lastTransitionTime);
    if (!at) continue;
    const type = str(cond.type);
    const status = str(cond.status);
    const reason = str(cond.reason);
    const message = str(cond.message);
    out.push({
      at,
      source: "condition",
      severity: HEALTH_CONDITIONS.has(type) && status === "False" ? "warning" : "normal",
      subject: `${kind}/${str(meta.name)}`,
      title: `${type} → ${status}`,
      detail: [reason, message].filter(Boolean).join(": "),
    });
  }

  for (const p of pods) {
    const pname = str(rec(p.metadata).name);
    for (const s of arr(rec(p.status).containerStatuses)) {
      const cs = rec(s);
      const term = rec(rec(cs.lastState).terminated);
      const at = str(term.finishedAt);
      if (!at) continue;
      const reason = str(term.reason) || "Terminated";
      const restarts = typeof cs.restartCount === "number" ? cs.restartCount : 0;
      out.push({
        at,
        source: "container",
        severity: reason === "Completed" ? "normal" : "warning",
        subject: `Pod/${pname}`,
        title: `${str(cs.name)} terminated: ${reason}`,
        detail: [
          typeof term.exitCode === "number" ? `exit ${term.exitCode}` : "",
          restarts ? `${restarts} restart${restarts === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }

  const t = (e: TimelineEntry) => Date.parse(e.at) || 0;
  return out.sort((a, b) => t(b) - t(a));
}
