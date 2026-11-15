import type { CRDEntry } from "./api";

export interface TrivyOperatorDetection {
  installed: boolean;
  vulnerabilityReportGvr?: string;
  clusterVulnerabilityReportGvr?: string;
}

/**
 * Detection is nearly free, same pattern as Karpenter/KEDA (backlog #2/#3):
 * filter the existing /api/crds discovery response client-side rather than
 * adding an engine-side install check. The served GVR is read straight off
 * discovery, never hardcoded, so a schema version bump in a future
 * Trivy-Operator release is picked up automatically.
 */
export function detectTrivyOperator(crds: CRDEntry[]): TrivyOperatorDetection {
  const vuln = crds.find((c) => c.group === "aquasecurity.github.io" && c.resource === "vulnerabilityreports");
  const clusterVuln = crds.find((c) => c.group === "aquasecurity.github.io" && c.resource === "clustervulnerabilityreports");
  return {
    installed: !!vuln,
    vulnerabilityReportGvr: vuln?.gvr,
    clusterVulnerabilityReportGvr: clusterVuln?.gvr,
  };
}
