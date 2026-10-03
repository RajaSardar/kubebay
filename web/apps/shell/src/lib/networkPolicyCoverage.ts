import { matchesSelector, type LabelSelector } from "./labelSelector";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

export type CoverageGapReason = "no-policy-in-namespace" | "not-selected-by-any-policy";

export interface CoverageGap {
  namespace: string;
  appLabel: string;
  podCount: number;
  reason: CoverageGapReason;
}

// Same convention pages/NetworkPolicy.tsx#podAppLabel uses for its own
// connectivity-matrix pod grouping -- kept consistent rather than
// introducing a second grouping scheme for the same feature area.
function podAppLabel(labels: Record<string, string>): string {
  return labels["app"] ?? labels["app.kubernetes.io/name"] ?? labels["k8s-app"] ?? "(unlabelled)";
}

interface PodGroup {
  namespace: string;
  appLabel: string;
  labels: Record<string, string>;
  podCount: number;
}

/**
 * Backlog #26: a flat, scannable list of "this pod group has zero
 * NetworkPolicy protection" -- the same "open" signal NetworkPolicy.tsx's
 * connectivity matrix already renders per cell, but as a direct findings
 * list rather than something a user has to notice by reading an N×N grid.
 * Grouped by namespace+app label (one finding per workload, not per pod),
 * matching SPOF Radar's own one-finding-per-workload convention.
 */
export function findNetworkPolicyCoverageGaps(
  pods: Record<string, unknown>[],
  networkPolicies: Record<string, unknown>[],
): CoverageGap[] {
  const groups = new Map<string, PodGroup>();
  for (const pod of pods) {
    const meta = rec(pod.metadata);
    const namespace = str(meta.namespace, "default");
    const labels = rec(meta.labels) as Record<string, string>;
    const appLabel = podAppLabel(labels);
    const key = `${namespace}/${appLabel}`;
    const existing = groups.get(key);
    if (existing) {
      existing.podCount++;
      existing.labels = { ...existing.labels, ...labels };
    } else {
      groups.set(key, { namespace, appLabel, labels, podCount: 1 });
    }
  }

  const policiesByNs = new Map<string, Record<string, unknown>[]>();
  for (const p of networkPolicies) {
    const ns = str(rec(p.metadata).namespace);
    const list = policiesByNs.get(ns) ?? [];
    list.push(p);
    policiesByNs.set(ns, list);
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.namespace === b.namespace ? a.appLabel.localeCompare(b.appLabel) : a.namespace.localeCompare(b.namespace),
  );

  const gaps: CoverageGap[] = [];
  for (const g of sortedGroups) {
    const nsPolicies = policiesByNs.get(g.namespace) ?? [];
    if (nsPolicies.length === 0) {
      gaps.push({ namespace: g.namespace, appLabel: g.appLabel, podCount: g.podCount, reason: "no-policy-in-namespace" });
      continue;
    }
    const selected = nsPolicies.some((p) => {
      const sel = rec(rec(p.spec).podSelector) as LabelSelector;
      return matchesSelector(g.labels, sel);
    });
    if (!selected) {
      gaps.push({ namespace: g.namespace, appLabel: g.appLabel, podCount: g.podCount, reason: "not-selected-by-any-policy" });
    }
  }
  return gaps;
}
