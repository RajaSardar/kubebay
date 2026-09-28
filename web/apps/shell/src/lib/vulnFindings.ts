function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface VulnFinding {
  id: string;
  /** One of SEVERITIES, or the report's own raw string if it doesn't match a known level. */
  severity: string;
  container: string;
  installedVersion?: string;
  fixedVersion?: string;
  primaryLink?: string;
  reportName: string;
  /** The report's own scan/update time — a stale report must never be mistaken for a live one. */
  updatedAt?: string;
}

function severityRank(s: string): number {
  const i = SEVERITIES.indexOf(s as Severity);
  return i === -1 ? SEVERITIES.length : i;
}

/**
 * Joins Trivy-Operator VulnerabilityReports to one pod by the same labels
 * Trivy-Operator itself writes (`trivy-operator.resource.{kind,name,namespace}`,
 * `trivy-operator.container.name`) rather than parsing the report's generated
 * name — verified against Trivy-Operator's own docs, not guessed. `ownerKind`/
 * `ownerName` is the pod's immediate controller (one hop — a ReplicaSet, not
 * the Deployment above it) or "Pod"/the pod's own name when it has no
 * controller, matching exactly what Trivy-Operator scans.
 */
export function findingsForPod(
  reports: Record<string, unknown>[],
  target: { ns: string; ownerKind: string; ownerName: string; containers: string[] },
): VulnFinding[] {
  const out: VulnFinding[] = [];
  for (const report of reports) {
    const meta = rec(report.metadata);
    const labels = rec(meta.labels);
    if (str(labels["trivy-operator.resource.kind"]) !== target.ownerKind) continue;
    if (str(labels["trivy-operator.resource.name"]) !== target.ownerName) continue;
    if (target.ns && str(labels["trivy-operator.resource.namespace"]) !== target.ns) continue;
    const container = str(labels["trivy-operator.container.name"]);
    if (target.containers.length > 0 && !target.containers.includes(container)) continue;

    const reportName = str(meta.name);
    const reportBody = rec(report.report);
    const updatedAt = str(reportBody.updateTimestamp) || undefined;
    for (const v of arr(reportBody.vulnerabilities)) {
      const vv = rec(v);
      out.push({
        id: str(vv.vulnerabilityID),
        severity: str(vv.severity) || "UNKNOWN",
        container,
        installedVersion: str(vv.installedVersion) || undefined,
        fixedVersion: str(vv.fixedVersion) || undefined,
        primaryLink: str(vv.primaryLink) || undefined,
        reportName,
        updatedAt,
      });
    }
  }
  return out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));
}

/** Tallies findings per severity level, for a summary line above the itemized list. */
export function severityCounts(findings: VulnFinding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const f of findings) {
    const key = SEVERITIES.includes(f.severity as Severity) ? (f.severity as Severity) : "UNKNOWN";
    counts[key]++;
  }
  return counts;
}
