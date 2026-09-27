function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}
function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface RolloutReplicaSet {
  name: string;
  revision: number;
  ready: number;
  desired: number;
  isNew: boolean;
}

export interface RolloutProgress {
  replicaSets: RolloutReplicaSet[];
  desiredReplicas: number;
  progressingReason?: string;
  progressingStatus?: string;
  /** True when the Progressing condition's reason is ProgressDeadlineExceeded. */
  stuck: boolean;
}

/**
 * Derives rollout progress from a Deployment and the full set of streamed
 * ReplicaSets — near-zero data cost since apps/v1/replicasets is already
 * streamed in full mode. Ownership is matched by UID (the same mechanism
 * Kubernetes itself uses), not by name pattern-matching.
 */
export function buildRolloutProgress(
  deployment: Record<string, unknown>,
  replicaSets: Record<string, unknown>[],
): RolloutProgress {
  const depUid = str(rec(deployment.metadata).uid);

  const owned = replicaSets.filter((rs) =>
    arr(rec(rs.metadata).ownerReferences).some((ref) => str(ref.uid) === depUid && depUid !== ""),
  );

  const withRevision = owned.map((rs) => {
    const meta = rec(rs.metadata);
    const annotations = rec(meta.annotations);
    return {
      name: str(meta.name),
      revision: parseInt(str(annotations["deployment.kubernetes.io/revision"]), 10) || 0,
      ready: num(rec(rs.status).readyReplicas),
      desired: num(rec(rs.spec).replicas),
    };
  });

  const maxRevision = withRevision.reduce((max, rs) => Math.max(max, rs.revision), -Infinity);

  const replicaSetsOut: RolloutReplicaSet[] = withRevision
    .map((rs) => ({ ...rs, isNew: rs.revision === maxRevision }))
    .sort((a, b) => b.revision - a.revision);

  const conditions = arr(rec(deployment.status).conditions);
  const progressing = conditions.find((c) => c.type === "Progressing");
  const progressingReason = progressing ? str(progressing.reason) : undefined;

  return {
    replicaSets: replicaSetsOut,
    desiredReplicas: num(rec(deployment.spec).replicas),
    progressingReason,
    progressingStatus: progressing ? str(progressing.status) : undefined,
    stuck: progressingReason === "ProgressDeadlineExceeded",
  };
}
