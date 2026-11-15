function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface PolicyFinding {
  policy: string;
  rule: string;
  result: string;
  message: string;
  severity?: string;
  category?: string;
  reportName: string;
}

/**
 * Backlog #12's IA ranking puts the drawer tab above a pre-flight card, a
 * row badge, or a standalone page — this is that tab's data layer. A
 * PolicyReport/ClusterPolicyReport result names the resources it applies to
 * directly (`resources[].{kind,name,namespace}`), so no report-level scope
 * field needs to be trusted; a cluster-scoped target simply has no
 * namespace to match against.
 */
export function findingsForResource(
  reports: Record<string, unknown>[],
  target: { kind: string; ns: string; name: string },
): PolicyFinding[] {
  const out: PolicyFinding[] = [];
  for (const report of reports) {
    const reportName = str(rec(report.metadata).name);
    for (const r of arr(report.results)) {
      const result = rec(r);
      const resources = arr(result.resources);
      const matches = resources.some((res) => {
        const rr = rec(res);
        if (str(rr.kind) !== target.kind || str(rr.name) !== target.name) return false;
        if (!target.ns) return true;
        return str(rr.namespace) === target.ns;
      });
      if (!matches) continue;
      out.push({
        policy: str(result.policy),
        rule: str(result.rule),
        result: str(result.result),
        message: str(result.message),
        severity: str(result.severity) || undefined,
        category: str(result.category) || undefined,
        reportName,
      });
    }
  }
  return out;
}
