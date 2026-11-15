function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface OwnerRef {
  kind: string;
  name: string;
}

/**
 * The pod's immediate controller — one hop only. Exported for backlog #16's
 * vulnerability-report join, which needs exactly this (Trivy-Operator scans
 * and labels by the pod's direct controller, e.g. a ReplicaSet, never the
 * Deployment above it) — resolveWorkloadOwner below over-walks to a
 * Deployment and would silently drop bare-Pod and StatefulSet/DaemonSet
 * owners that #16 still needs to match.
 */
export function controllerOwner(obj: Record<string, unknown>): OwnerRef | null {
  const refs = arr(rec(obj.metadata).ownerReferences);
  for (const r of refs) {
    const rr = rec(r);
    if (rr.controller === true) return { kind: str(rr.kind), name: str(rr.name) };
  }
  return null;
}

const DIRECT_KINDS = new Set(["StatefulSet", "DaemonSet"]);

/**
 * Mirrors the engine's own resolveWorkload (internal/waste/waste.go) so a
 * Pod's ResizePanel can look up the same right-sizing row the ranked view
 * would show for its owning workload. A pod owned by a ReplicaSet resolves
 * one hop further to that ReplicaSet's own Deployment owner; Jobs/CronJobs
 * and bare pods are out of scope, same as the rest of right-sizing.
 */
export function resolveWorkloadOwner(
  pod: Record<string, unknown>,
  ns: string,
  replicaSets: Record<string, unknown>[],
): { kind: string; name: string } | null {
  const owner = controllerOwner(pod);
  if (!owner) return null;

  if (owner.kind === "ReplicaSet") {
    const rs = replicaSets.find((r) => str(rec(r.metadata).name) === owner.name && str(rec(r.metadata).namespace) === ns);
    if (!rs) return null;
    const rsOwner = controllerOwner(rs);
    if (!rsOwner || rsOwner.kind !== "Deployment") return null;
    return rsOwner;
  }

  if (DIRECT_KINDS.has(owner.kind)) return owner;
  return null;
}
