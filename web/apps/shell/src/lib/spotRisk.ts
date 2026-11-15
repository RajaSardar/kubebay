import { matchesSelector, type LabelSelector } from "./labelSelector";
import { controllerOwner } from "./podOwner";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

// Capacity-type labels each provider/provisioner stamps on spot/preemptible nodes.
const SPOT_LABELS: [string, string][] = [
  ["karpenter.sh/capacity-type", "spot"],
  ["eks.amazonaws.com/capacityType", "SPOT"],
  ["cloud.google.com/gke-spot", "true"],
  ["cloud.google.com/gke-preemptible", "true"],
  ["kubernetes.azure.com/scalesetpriority", "spot"],
];

export function isSpotNode(node: Record<string, unknown>): boolean {
  const labels = rec(rec(node.metadata).labels);
  return SPOT_LABELS.some(([k, v]) => labels[k] === v);
}

export type SpotRiskReason = "single-replica-on-spot" | "no-pdb-on-spot";

export interface SpotRiskFinding {
  namespace: string;
  appLabel: string;
  podCount: number;
  reason: SpotRiskReason;
}

function podAppLabel(labels: Record<string, string>): string {
  return labels["app"] ?? labels["app.kubernetes.io/name"] ?? labels["k8s-app"] ?? "(unlabelled)";
}

/**
 * Backlog #30: a workload whose every running replica sits on spot /
 * preemptible capacity can lose all of them to one reclaim wave. Flags it
 * when it's single-replica (a PDB can't help -- spot reclaims don't go
 * through the eviction API) or when multi-replica with no PDB covering it
 * (the drains Karpenter/cluster-autoscaler run ahead of a reclaim are then
 * uncoordinated). DaemonSet pods are skipped: they run per node by design.
 */
export function findSpotRiskWorkloads(
  pods: Record<string, unknown>[],
  nodes: Record<string, unknown>[],
  pdbs: Record<string, unknown>[],
): SpotRiskFinding[] {
  const spotNodes = new Set(nodes.filter(isSpotNode).map((n) => str(rec(n.metadata).name)));
  if (spotNodes.size === 0) return [];

  interface Group {
    namespace: string;
    appLabel: string;
    labels: Record<string, string>;
    podCount: number;
    allOnSpot: boolean;
  }
  const groups = new Map<string, Group>();

  for (const pod of pods) {
    if (str(rec(pod.status).phase) !== "Running") continue;
    const nodeName = str(rec(pod.spec).nodeName);
    if (!nodeName) continue;
    if (controllerOwner(pod)?.kind === "DaemonSet") continue;

    const meta = rec(pod.metadata);
    const namespace = str(meta.namespace, "default");
    const labels = rec(meta.labels) as Record<string, string>;
    const appLabel = podAppLabel(labels);
    const key = `${namespace}/${appLabel}`;
    const onSpot = spotNodes.has(nodeName);
    const g = groups.get(key);
    if (g) {
      g.podCount++;
      g.allOnSpot = g.allOnSpot && onSpot;
    } else {
      groups.set(key, { namespace, appLabel, labels, podCount: 1, allOnSpot: onSpot });
    }
  }

  const out: SpotRiskFinding[] = [];
  for (const g of groups.values()) {
    if (!g.allOnSpot) continue;
    if (g.podCount === 1) {
      out.push({ namespace: g.namespace, appLabel: g.appLabel, podCount: 1, reason: "single-replica-on-spot" });
      continue;
    }
    const covered = pdbs.some((p) => {
      if (str(rec(p.metadata).namespace) !== g.namespace) return false;
      return matchesSelector(g.labels, rec(rec(p.spec).selector) as LabelSelector);
    });
    if (!covered) out.push({ namespace: g.namespace, appLabel: g.appLabel, podCount: g.podCount, reason: "no-pdb-on-spot" });
  }

  return out.sort((a, b) => (a.namespace === b.namespace ? a.appLabel.localeCompare(b.appLabel) : a.namespace.localeCompare(b.namespace)));
}
