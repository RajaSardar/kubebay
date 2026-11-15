import { matchesSelector, type LabelSelector } from "./labelSelector";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface NodePoolImpact {
  nodeCount: number;
  podCount: number;
  namespaceCount: number;
  spotCount: number;
  pdbProtectedPodCount: number;
}

/**
 * Blast-radius summary for the Karpenter safe-editing impact banner
 * (backlog #3 P2): "backs N nodes / M pods / K namespaces; P pods have
 * PDBs; Q are spot" — computed entirely from streams the Karpenter page
 * already has open, no new API calls. PDB coverage uses the PDB's own
 * selector rather than "same namespace" so the count isn't a wild
 * overestimate on a namespace with several unrelated PDBs.
 */
export function computeNodePoolImpact(
  poolName: string,
  nodes: Record<string, unknown>[],
  pods: Record<string, unknown>[],
  pdbs: Record<string, unknown>[],
): NodePoolImpact {
  const myNodes = nodes.filter((n) => str((rec(rec(n.metadata).labels))["karpenter.sh/nodepool"]) === poolName);
  const nodeNames = new Set(myNodes.map((n) => str(rec(n.metadata).name)));
  const myPods = pods.filter((p) => nodeNames.has(str(rec(p.spec).nodeName)));
  const namespaces = new Set(myPods.map((p) => str(rec(p.metadata).namespace)));
  const spotCount = myNodes.filter((n) => str((rec(rec(n.metadata).labels))["karpenter.sh/capacity-type"]) === "spot").length;

  const pdbsByNs = new Map<string, LabelSelector[]>();
  for (const pdb of pdbs) {
    const ns = str(rec(pdb.metadata).namespace);
    const selector = rec(rec(pdb.spec).selector) as LabelSelector;
    pdbsByNs.set(ns, [...(pdbsByNs.get(ns) ?? []), selector]);
  }

  let pdbProtectedPodCount = 0;
  for (const pod of myPods) {
    const ns = str(rec(pod.metadata).namespace);
    const labels = rec(rec(pod.metadata).labels) as Record<string, string>;
    const selectors = pdbsByNs.get(ns) ?? [];
    if (selectors.some((s) => matchesSelector(labels, s))) pdbProtectedPodCount++;
  }

  return {
    nodeCount: myNodes.length,
    podCount: myPods.length,
    namespaceCount: namespaces.size,
    spotCount,
    pdbProtectedPodCount,
  };
}
