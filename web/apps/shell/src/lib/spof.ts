import { matchesSelector, type LabelSelector } from "./labelSelector";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

export type SpofKind = "no-pdb" | "no-spread" | "single-backend";

export interface SpofFinding {
  kind: SpofKind;
  ns: string;
  name: string;
  workloadKind: string;
  detail: string;
}

export interface WorkloadEntry {
  kind: string;
  obj: Record<string, unknown>;
}

const SPOF_WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet"]);

function podTemplateLabels(workload: Record<string, unknown>): Record<string, string> {
  const labels = rec(rec(rec(rec(workload.spec).template).metadata).labels);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function replicasOf(workload: Record<string, unknown>): number {
  return num(rec(workload.spec).replicas, 1);
}

/**
 * Flags a single-replica Deployment/StatefulSet with no PodDisruptionBudget
 * covering its pods (backlog #24) -- it has zero eviction-coordination
 * guarantee, so any voluntary disruption (a node drain, an upgrade) can take
 * it down with nothing in the cluster even trying to prevent it. Reuses
 * lib/labelSelector.ts#matchesSelector -- the real K8s LabelSelector engine
 * #3's Karpenter impact banner already built for this exact "does this PDB's
 * selector actually cover this pod" question.
 */
export function findSingleReplicaNoPdb(workloads: WorkloadEntry[], pdbs: Record<string, unknown>[]): SpofFinding[] {
  const out: SpofFinding[] = [];
  for (const { kind, obj } of workloads) {
    if (!SPOF_WORKLOAD_KINDS.has(kind)) continue;
    if (replicasOf(obj) > 1) continue;
    const meta = rec(obj.metadata);
    const ns = str(meta.namespace);
    const name = str(meta.name);
    const labels = podTemplateLabels(obj);
    const covered = pdbs.some((pdb) => {
      const pdbMeta = rec(pdb.metadata);
      if (str(pdbMeta.namespace) !== ns) return false;
      const selector = rec(rec(pdb.spec).selector) as LabelSelector;
      return matchesSelector(labels, selector);
    });
    if (!covered) {
      out.push({
        kind: "no-pdb",
        ns,
        name,
        workloadKind: kind,
        detail: `${kind} "${name}" runs a single replica with no PodDisruptionBudget covering it — any voluntary disruption (node drain, upgrade) can take it down with no coordination.`,
      });
    }
  }
  return out;
}

function hasSpreadOrAntiAffinity(workload: Record<string, unknown>): boolean {
  const podSpec = rec(rec(rec(workload.spec).template).spec);
  if (arr(podSpec.topologySpreadConstraints).length > 0) return true;
  const antiAffinity = rec(rec(podSpec.affinity).podAntiAffinity);
  return (
    arr(antiAffinity.requiredDuringSchedulingIgnoredDuringExecution).length > 0 ||
    arr(antiAffinity.preferredDuringSchedulingIgnoredDuringExecution).length > 0
  );
}

/**
 * Flags a multi-replica workload with no topology-spread constraint and no
 * pod anti-affinity whose live pods are all currently scheduled onto a
 * single node -- a node failure takes out every replica simultaneously,
 * even though the workload "looks" highly available by replica count alone.
 */
export function findClusteredReplicas(workloads: WorkloadEntry[], pods: Record<string, unknown>[]): SpofFinding[] {
  const out: SpofFinding[] = [];
  for (const { kind, obj } of workloads) {
    if (!SPOF_WORKLOAD_KINDS.has(kind)) continue;
    if (replicasOf(obj) <= 1) continue;
    if (hasSpreadOrAntiAffinity(obj)) continue;
    const meta = rec(obj.metadata);
    const ns = str(meta.namespace);
    const name = str(meta.name);
    const labels = podTemplateLabels(obj);
    const labelEntries = Object.entries(labels);
    const ownPods = pods.filter((p) => {
      const pm = rec(p.metadata);
      if (str(pm.namespace) !== ns) return false;
      const plabels = rec(pm.labels);
      return labelEntries.every(([k, v]) => plabels[k] === v);
    });
    if (ownPods.length < 2) continue;
    const nodes = new Set(ownPods.map((p) => str(rec(p.spec).nodeName)).filter(Boolean));
    if (nodes.size <= 1) {
      out.push({
        kind: "no-spread",
        ns,
        name,
        workloadKind: kind,
        detail: `${kind} "${name}" has ${ownPods.length} replicas but no topology spread or anti-affinity, and they're all on the same node — one node failure takes down every replica at once.`,
      });
    }
  }
  return out;
}

/**
 * Flags a Service whose current EndpointSlice(s) carry exactly one Ready
 * backend -- regardless of desired replica count, all traffic funnels
 * through one pod right now.
 */
export function findSingleReadyBackend(services: Record<string, unknown>[], endpointSlices: Record<string, unknown>[]): SpofFinding[] {
  const out: SpofFinding[] = [];
  for (const svc of services) {
    const meta = rec(svc.metadata);
    const ns = str(meta.namespace);
    const name = str(meta.name);
    const slices = endpointSlices.filter((es) => {
      const esMeta = rec(es.metadata);
      if (str(esMeta.namespace) !== ns) return false;
      const labels = rec(esMeta.labels);
      return str(labels["kubernetes.io/service-name"]) === name;
    });
    if (slices.length === 0) continue;

    let readyCount = 0;
    for (const slice of slices) {
      for (const ep of arr(slice.endpoints)) {
        const epRec = rec(ep);
        const ready = rec(epRec.conditions).ready;
        if (ready !== false) readyCount += arr(epRec.addresses).length || 1;
      }
    }
    if (readyCount === 1) {
      out.push({
        kind: "single-backend",
        ns,
        name,
        workloadKind: "Service",
        detail: `Service "${name}" currently has exactly one Ready backend — all traffic funnels through a single pod right now.`,
      });
    }
  }
  return out;
}

/** Runs all three SPOF checks over the resources SpofRadar.tsx already streams. */
export function computeSpofFindings(input: {
  deployments: Record<string, unknown>[];
  statefulSets: Record<string, unknown>[];
  pdbs: Record<string, unknown>[];
  pods: Record<string, unknown>[];
  services: Record<string, unknown>[];
  endpointSlices: Record<string, unknown>[];
}): SpofFinding[] {
  const workloads: WorkloadEntry[] = [
    ...input.deployments.map((obj) => ({ kind: "Deployment", obj })),
    ...input.statefulSets.map((obj) => ({ kind: "StatefulSet", obj })),
  ];
  return [
    ...findSingleReplicaNoPdb(workloads, input.pdbs),
    ...findClusteredReplicas(workloads, input.pods),
    ...findSingleReadyBackend(input.services, input.endpointSlices),
  ];
}
