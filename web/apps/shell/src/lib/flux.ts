import type { CRDEntry } from "./api";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface FluxDetection {
  installed: boolean;
  kustomizationGvr?: string;
  helmReleaseGvr?: string;
}

/**
 * Same "nearly free" detection pattern as KEDA/Karpenter: filter the
 * existing /api/crds response rather than adding an engine-side check.
 * Flux ships two independently-installable controllers (kustomize- and
 * helm-controller), so either CRD alone counts as "installed" — a
 * Kustomization-only install is common and shouldn't show as absent.
 */
export function detectFlux(crds: CRDEntry[]): FluxDetection {
  const kustomization = crds.find((c) => c.group === "kustomize.toolkit.fluxcd.io" && c.resource === "kustomizations");
  const helmRelease = crds.find((c) => c.group === "helm.toolkit.fluxcd.io" && c.resource === "helmreleases");
  return {
    installed: !!kustomization || !!helmRelease,
    kustomizationGvr: kustomization?.gvr,
    helmReleaseGvr: helmRelease?.gvr,
  };
}

export interface FluxObjectStatus {
  kind: "Kustomization" | "HelmRelease";
  name: string;
  ns: string;
  ready: boolean | null;
  readyMessage: string;
  managedResourceCount: number;
  driftEventCount: number;
}

function readyCondition(obj: Record<string, unknown>): { status: string; message: string } | null {
  const conditions = arr(rec(obj.status).conditions);
  for (const c of conditions) {
    const cc = rec(c);
    if (str(cc.type) === "Ready") return { status: str(cc.status), message: str(cc.message) };
  }
  return null;
}

/**
 * Flux's kustomize-controller *corrects* drift on reconcile rather than
 * just reporting it, so — per the backlog's explicit framing — this can't
 * share Argo's "diff against desired state" UI. The three honest signals
 * available: the Ready condition (build/apply/health outcome),
 * status.inventory.entries (what this object currently manages, no
 * line-level diff needed since Flux already re-applied anything that drifted),
 * and DriftDetected events (drift *did* happen, even though it's already
 * been corrected by the time this renders).
 */
export function summarizeFluxObject(
  obj: Record<string, unknown>,
  kind: "Kustomization" | "HelmRelease",
  driftEvents: Record<string, unknown>[],
): FluxObjectStatus {
  const meta = rec(obj.metadata);
  const name = str(meta.name);
  const ns = str(meta.namespace);
  const ready = readyCondition(obj);

  const driftEventCount = driftEvents.filter((e) => {
    if (!str(e.reason).toLowerCase().includes("drift")) return false;
    const involved = rec(e.involvedObject);
    return str(involved.kind) === kind && str(involved.name) === name && str(involved.namespace) === ns;
  }).length;

  return {
    kind,
    name,
    ns,
    ready: ready ? ready.status === "True" : null,
    readyMessage: ready?.message ?? "",
    managedResourceCount: arr(rec(rec(obj.status).inventory).entries).length,
    driftEventCount,
  };
}
