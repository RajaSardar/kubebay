import { controllerOwner } from "./podOwner";
import { matchesFilter } from "./tableUx";

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
  /** The vulnerable package (Trivy's `resource`). */
  pkg?: string;
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

const bySeverity = (a: VulnFinding, b: VulnFinding) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id);

/** A report's findings, each carrying the report's container and scan time. */
function reportFindings(report: Record<string, unknown>): VulnFinding[] {
  const meta = rec(report.metadata);
  const container = str(rec(meta.labels)["trivy-operator.container.name"]);
  const reportName = str(meta.name);
  const reportBody = rec(report.report);
  const updatedAt = str(reportBody.updateTimestamp) || undefined;
  return arr(reportBody.vulnerabilities).map((v) => {
    const vv = rec(v);
    return {
      id: str(vv.vulnerabilityID),
      severity: str(vv.severity) || "UNKNOWN",
      container,
      pkg: str(vv.resource) || undefined,
      installedVersion: str(vv.installedVersion) || undefined,
      fixedVersion: str(vv.fixedVersion) || undefined,
      primaryLink: str(vv.primaryLink) || undefined,
      reportName,
      updatedAt,
    };
  });
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
    out.push(...reportFindings(report));
  }
  return out.sort(bySeverity);
}

/**
 * Resolves which Trivy-Operator resource.kind/resource.name pairs a
 * workload's own reports are labeled with (backlog #16 Phase 2). A
 * Deployment is never the labeled owner itself -- its pods are owned by its
 * ReplicaSet(s), and there can be more than one mid-rollout (old + new) -- so
 * this walks that hop using the namespace's live ReplicaSets. StatefulSet
 * and DaemonSet own their pods directly, matching Trivy-Operator's label
 * with no extra hop.
 */
export function ownerNamesForWorkload(
  kind: string,
  name: string,
  ns: string,
  replicaSets: Record<string, unknown>[],
): { ownerKind: string; ownerNames: string[] } {
  if (kind !== "Deployment") {
    return { ownerKind: kind, ownerNames: [name] };
  }
  const ownerNames = replicaSets
    .filter((rs) => {
      const owner = controllerOwner(rs);
      return owner?.kind === "Deployment" && owner.name === name && str(rec(rs.metadata).namespace) === ns;
    })
    .map((rs) => str(rec(rs.metadata).name));
  return { ownerKind: "ReplicaSet", ownerNames };
}

/**
 * Workload-level rollup (backlog #16 Phase 2): aggregates findings across
 * every pod-owner behind a Deployment/StatefulSet/DaemonSet, the "does
 * anything in this rollout have a Critical CVE" view -- unlike
 * `findingsForPod`, this matches any of several owner names at once (a
 * Deployment mid-rollout can have both an old and a new ReplicaSet live
 * simultaneously) and doesn't filter by container, since a workload-level
 * view wants every container across every pod, not one pod's own list.
 */
export function findingsForWorkload(
  reports: Record<string, unknown>[],
  target: { ns: string; ownerKind: string; ownerNames: string[] },
): VulnFinding[] {
  const nameSet = new Set(target.ownerNames);
  const out: VulnFinding[] = [];
  for (const report of reports) {
    const meta = rec(report.metadata);
    const labels = rec(meta.labels);
    if (str(labels["trivy-operator.resource.kind"]) !== target.ownerKind) continue;
    if (!nameSet.has(str(labels["trivy-operator.resource.name"]))) continue;
    if (target.ns && str(labels["trivy-operator.resource.namespace"]) !== target.ns) continue;
    out.push(...reportFindings(report));
  }
  return out.sort(bySeverity);
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

/** One workload's findings, for the Vulnerabilities page (root backlog #16). */
export interface VulnWorkload {
  /** `namespace/Kind/name`: the row's identity, and what a link to it names. */
  key: string;
  ns: string;
  kind: string;
  name: string;
  /** Worst first. */
  findings: VulnFinding[];
  counts: Record<Severity, number>;
  /** Findings with a version that fixes them. */
  fixable: number;
  /** The images scanned, `repository:tag`. */
  images: string[];
  /** When the newest of its reports was scanned. */
  scannedAt?: string;
}

/**
 * The workload a report belongs to, as people know it. Trivy-Operator labels a
 * report with the pod's immediate owner, which for a Deployment is one of its
 * ReplicaSets; `rsDeployment` maps `namespace/replicaset` to that Deployment.
 */
export function vulnOwner(kind: string, name: string, ns: string, rsDeployment: Map<string, string>): { kind: string; name: string } {
  const deployment = kind === "ReplicaSet" ? rsDeployment.get(`${ns}/${name}`) : undefined;
  return deployment ? { kind: "Deployment", name: deployment } : { kind, name };
}

/** The ReplicaSets' Deployments, `namespace/replicaset` → Deployment name. */
export function replicaSetDeployments(replicaSets: Record<string, unknown>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const rs of replicaSets) {
    const owner = controllerOwner(rs);
    if (owner?.kind !== "Deployment") continue;
    const meta = rec(rs.metadata);
    out.set(`${str(meta.namespace)}/${str(meta.name)}`, owner.name);
  }
  return out;
}

/**
 * Every workload with findings, one row each, worst first: most Critical, then
 * High, Medium and Low. A Deployment's row gathers the reports of all its
 * ReplicaSets (old and new mid-rollout) and all its containers.
 */
export function vulnWorkloads(reports: Record<string, unknown>[], replicaSets: Record<string, unknown>[]): VulnWorkload[] {
  const rsDeployment = replicaSetDeployments(replicaSets);
  const rows = new Map<string, VulnWorkload>();
  for (const report of reports) {
    const meta = rec(report.metadata);
    const labels = rec(meta.labels);
    const ns = str(labels["trivy-operator.resource.namespace"]) || str(meta.namespace);
    const owner = vulnOwner(str(labels["trivy-operator.resource.kind"]), str(labels["trivy-operator.resource.name"]), ns, rsDeployment);
    const findings = reportFindings(report);
    if (!owner.kind || !owner.name || findings.length === 0) continue;
    const key = `${ns}/${owner.kind}/${owner.name}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, ns, kind: owner.kind, name: owner.name, findings: [], counts: severityCounts([]), fixable: 0, images: [] };
      rows.set(key, row);
    }
    row.findings.push(...findings);
    const reportBody = rec(report.report);
    const artifact = rec(reportBody.artifact);
    const image = [str(artifact.repository), str(artifact.tag)].filter(Boolean).join(":");
    if (image && !row.images.includes(image)) row.images.push(image);
    const scanned = str(reportBody.updateTimestamp);
    if (scanned && (!row.scannedAt || scanned > row.scannedAt)) row.scannedAt = scanned;
  }
  const out = [...rows.values()];
  for (const row of out) {
    row.findings.sort(bySeverity);
    row.counts = severityCounts(row.findings);
    row.fixable = row.findings.filter((f) => f.fixedVersion).length;
    row.images.sort();
  }
  return out.sort(
    (a, b) =>
      b.counts.CRITICAL - a.counts.CRITICAL ||
      b.counts.HIGH - a.counts.HIGH ||
      b.counts.MEDIUM - a.counts.MEDIUM ||
      b.counts.LOW - a.counts.LOW ||
      a.ns.localeCompare(b.ns) ||
      a.name.localeCompare(b.name),
  );
}

/** Whether a workload matches the page's filter: its name, namespace, kind, an image, a CVE it has or a package. */
export function matchesVulnQuery(w: VulnWorkload, query: string): boolean {
  if (!query.trim()) return true;
  const fields = [w.name, w.ns, w.kind, ...w.images];
  for (const f of w.findings) {
    fields.push(f.id);
    if (f.pkg) fields.push(f.pkg);
  }
  return matchesFilter(fields, query);
}
