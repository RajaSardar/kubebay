import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, Button, EmptyState } from "@kubebay/ui";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { detectTrivyOperator } from "../lib/trivyOperator";
import { controllerOwner } from "../lib/podOwner";
import { findingsForPod, severityCounts, type VulnFinding } from "../lib/vulnFindings";

const SEVERITY_TONE: Record<string, "err" | "ok" | undefined> = {
  CRITICAL: "err",
  HIGH: "err",
};

/**
 * Backlog #16 P1: default view is Critical+High only (the spec's own
 * "summarize passing, itemize the rest" instinct, same as PolicyFindingsSummary)
 * with a "show all N" disclosure for Medium/Low/Unknown, rather than dumping
 * every low-severity CVE. Each row surfaces the report's own scan timestamp —
 * Trivy-Operator scans on a schedule, not on every pod start, so a freshly
 * rolled pod can show a report for an older image instance.
 */
export function VulnFindingsSummary({ findings }: { findings: VulnFinding[] }) {
  const [showAll, setShowAll] = useState(false);

  if (findings.length === 0) {
    return (
      <EmptyState style={{ padding: 14 }} title="No vulnerability findings for this pod." />
    );
  }

  const counts = severityCounts(findings);
  const topSeverity = findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");
  const rest = findings.filter((f) => f.severity !== "CRITICAL" && f.severity !== "HIGH");
  const shown = showAll ? findings : topSeverity;

  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="muted small">
        {counts.CRITICAL} critical · {counts.HIGH} high · {counts.MEDIUM} medium · {counts.LOW} low
        {counts.UNKNOWN > 0 ? ` · ${counts.UNKNOWN} unknown` : ""}
      </div>
      {shown.map((f, i) => (
        <Card key={`${f.reportName}-${f.id}-${i}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
            <span className="mono strong small">{f.id}</span>
            <span className="muted small">({f.container})</span>
          </div>
          {(f.installedVersion || f.fixedVersion) && (
            <div className="small" style={{ marginTop: 4 }}>
              {f.installedVersion ?? "unknown"} → {f.fixedVersion ?? "no fix available"}
            </div>
          )}
          {f.primaryLink && (
            <div className="small">
              <a href={f.primaryLink} target="_blank" rel="noreferrer">
                {f.primaryLink}
              </a>
            </div>
          )}
          {f.updatedAt && <div className="muted small mono">scanned {f.updatedAt}</div>}
        </Card>
      ))}
      {rest.length > 0 && !showAll && (
        <Button variant="ghost" onClick={() => setShowAll(true)}>
          Show all {findings.length}
        </Button>
      )}
    </div>
  );
}

/**
 * Data-fetching half: detects Trivy-Operator the same way Karpenter/KEDA do
 * (a client-side /api/crds filter, degrading to an empty tab when absent,
 * never a broken subscription), resolves the pod's immediate controller
 * (one hop — matches what Trivy-Operator itself scans and labels), and
 * subscribes scoped to this pod's own namespace + a labelSelector on that
 * owner rather than a cluster-wide full-mode stream, since a
 * VulnerabilityReport's vulnerabilities[] array can run into the hundreds of
 * entries per container.
 */
export function PodVulnerabilitiesTab({
  cluster,
  ns,
  podName,
  containers,
  podObj,
}: {
  cluster: string;
  ns: string;
  podName: string;
  containers: string[];
  podObj?: Record<string, unknown>;
}) {
  const crds = useQuery({
    queryKey: ["crds", cluster],
    queryFn: () => crdApi.list(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const detection = useMemo(() => detectTrivyOperator(crds.data ?? []), [crds.data]);

  const owner = useMemo(() => (podObj ? controllerOwner(podObj) : null) ?? { kind: "Pod", name: podName }, [podObj, podName]);
  const labelSelector = `trivy-operator.resource.kind=${owner.kind},trivy-operator.resource.name=${owner.name}`;

  const reports = useResourceStream(detection.vulnerabilityReportGvr ? cluster : undefined, detection.vulnerabilityReportGvr ?? "", {
    ns: [ns],
    labelSelector,
    mode: "full",
    enabled: !!detection.vulnerabilityReportGvr,
  });

  const findings = useMemo(
    () => findingsForPod(reports.rows, { ns, ownerKind: owner.kind, ownerName: owner.name, containers }),
    [reports.rows, ns, owner, containers],
  );

  return <VulnFindingsSummary findings={findings} />;
}
