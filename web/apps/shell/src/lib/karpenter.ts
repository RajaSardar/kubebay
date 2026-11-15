import type { CRDEntry } from "./api";
import { parseCpuMillis, parseMemBytes } from "./rightsizing";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export interface KarpenterDetection {
  installed: boolean;
  nodePoolGvr?: string;
  nodeClaimGvr?: string;
}

/**
 * Detection is nearly free (same pattern as KEDA, backlog #2): filter the
 * existing /api/crds discovery response client-side rather than adding an
 * engine-side install check. The served version is read straight off the
 * discovered GVR — never hardcoded — so a v1beta1-only install (older
 * Karpenter) is detected exactly the same as a v1 one, per the backlog's
 * explicit API-churn risk.
 */
export function detectKarpenter(crds: CRDEntry[]): KarpenterDetection {
  const nodePool = crds.find((c) => c.group === "karpenter.sh" && c.resource === "nodepools");
  const nodeClaim = crds.find((c) => c.group === "karpenter.sh" && c.resource === "nodeclaims");
  return {
    installed: !!nodePool,
    nodePoolGvr: nodePool?.gvr,
    nodeClaimGvr: nodeClaim?.gvr,
  };
}

export interface NodePoolRow {
  name: string;
  nodeCount: number;
  podCount: number;
  namespaceCount: number;
  spotCount: number;
  onDemandCount: number;
  limitCpuMillis?: number;
  limitMemBytes?: number;
  usedCpuMillis?: number;
  usedMemBytes?: number;
}

/**
 * Per-NodePool stats (backlog #3 P1): limits and current resources come
 * straight off the NodePool's own `.spec.limits`/`.status.resources` — no
 * join needed, Karpenter already aggregates those. Node count, capacity-type
 * mix, and pod/namespace counts still need the join, via the
 * `karpenter.sh/nodepool` label every Karpenter-provisioned node carries.
 */
export function buildNodePoolRows(
  nodePools: Record<string, unknown>[],
  nodes: Record<string, unknown>[],
  pods: Record<string, unknown>[],
): NodePoolRow[] {
  return nodePools.map((np) => {
    const name = str(rec(np.metadata).name);
    const myNodes = nodes.filter((n) => str((rec(rec(n.metadata).labels))["karpenter.sh/nodepool"]) === name);
    const nodeNames = new Set(myNodes.map((n) => str(rec(n.metadata).name)));
    const myPods = pods.filter((p) => nodeNames.has(str(rec(p.spec).nodeName)));
    const namespaces = new Set(myPods.map((p) => str(rec(p.metadata).namespace)));

    const spotCount = myNodes.filter((n) => str((rec(rec(n.metadata).labels))["karpenter.sh/capacity-type"]) === "spot").length;
    const onDemandCount = myNodes.filter((n) => str((rec(rec(n.metadata).labels))["karpenter.sh/capacity-type"]) === "on-demand").length;

    const limits = rec(rec(np.spec).limits);
    const used = rec(rec(np.status).resources);

    return {
      name,
      nodeCount: myNodes.length,
      podCount: myPods.length,
      namespaceCount: namespaces.size,
      spotCount,
      onDemandCount,
      limitCpuMillis: limits.cpu !== undefined ? parseCpuMillis(str(limits.cpu)) : undefined,
      limitMemBytes: limits.memory !== undefined ? parseMemBytes(str(limits.memory)) : undefined,
      usedCpuMillis: used.cpu !== undefined ? parseCpuMillis(str(used.cpu)) : undefined,
      usedMemBytes: used.memory !== undefined ? parseMemBytes(str(used.memory)) : undefined,
    };
  });
}

export interface UnschedulablePod {
  ns: string;
  pod: string;
  message: string;
  count: number;
  lastTimestamp: string;
}

/**
 * The second P1 panel: unschedulable pods with FailedScheduling quoted
 * verbatim, since the apiserver's own message names the actual blocking
 * constraint (insufficient cpu, no matching taint tolerations, …) far more
 * precisely than anything Kubebay could synthesize.
 */
export function buildUnschedulablePods(events: Record<string, unknown>[]): UnschedulablePod[] {
  return events
    .filter((e) => str(e.reason) === "FailedScheduling" && str(rec(e.involvedObject).kind) === "Pod")
    .map((e) => {
      const involved = rec(e.involvedObject);
      return {
        ns: str(involved.namespace),
        pod: str(involved.name),
        message: str(e.message),
        count: num(e.count) || 1,
        lastTimestamp: str(e.lastTimestamp),
      };
    })
    .sort((a, b) => Date.parse(b.lastTimestamp) - Date.parse(a.lastTimestamp));
}
