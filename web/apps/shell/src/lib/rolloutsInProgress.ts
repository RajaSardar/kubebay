type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return (v ?? {}) as Obj;
}
function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}
function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface RolloutRow {
  key: string;
  kind: "Deployment" | "StatefulSet" | "DaemonSet";
  namespace: string;
  name: string;
  updated: number;
  ready: number;
  desired: number;
  /** Past its progress deadline. */
  stalled: boolean;
  /** Why it stalled (the Progressing condition's message). */
  reason?: string;
  workload: Obj;
}

const ROLLING = new Set(["ReplicaSetUpdated", "NewReplicaSetCreated", "FoundNewReplicaSet"]);

function base(kind: RolloutRow["kind"], o: Obj) {
  const meta = rec(o.metadata);
  const namespace = str(meta.namespace);
  const name = str(meta.name);
  return { key: `${kind}/${namespace}/${name}`, kind, namespace, name, workload: o };
}

/**
 * Overview v2: the workloads rolling out right now, stalled ones first. A
 * Deployment counts while its Progressing condition says it is updating or
 * its spec change is unseen; StatefulSets by revision; DaemonSets by updated
 * nodes. Paused Deployments are left out.
 */
export function rolloutsInProgress(input: { deployments: Obj[]; statefulSets: Obj[]; daemonSets: Obj[] }): RolloutRow[] {
  const rows: RolloutRow[] = [];

  for (const d of input.deployments) {
    const spec = rec(d.spec);
    if (spec.paused === true) continue;
    const status = rec(d.status);
    const meta = rec(d.metadata);
    const progressing = arr(status.conditions).find((c) => c.type === "Progressing");
    const reason = str(progressing?.reason);
    const stalled = reason === "ProgressDeadlineExceeded";
    const unseen = num(meta.generation) > num(status.observedGeneration);
    if (!stalled && !unseen && !ROLLING.has(reason)) continue;
    rows.push({
      ...base("Deployment", d),
      updated: num(status.updatedReplicas),
      ready: num(status.readyReplicas),
      desired: typeof spec.replicas === "number" ? spec.replicas : 1,
      stalled,
      reason: stalled ? str(progressing?.message) : undefined,
    });
  }

  for (const s of input.statefulSets) {
    const status = rec(s.status);
    const update = str(status.updateRevision);
    if (!update || update === str(status.currentRevision)) continue;
    const spec = rec(s.spec);
    rows.push({
      ...base("StatefulSet", s),
      updated: num(status.updatedReplicas),
      ready: num(status.readyReplicas),
      desired: typeof spec.replicas === "number" ? spec.replicas : 1,
      stalled: false,
    });
  }

  for (const ds of input.daemonSets) {
    const status = rec(ds.status);
    const desired = num(status.desiredNumberScheduled);
    const updated = num(status.updatedNumberScheduled);
    if (updated >= desired) continue;
    rows.push({ ...base("DaemonSet", ds), updated, ready: num(status.numberReady), desired, stalled: false });
  }

  return rows.sort((a, b) => Number(b.stalled) - Number(a.stalled));
}
