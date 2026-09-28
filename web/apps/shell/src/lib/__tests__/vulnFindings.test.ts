import { describe, it, expect } from "vitest";
import { findingsForPod, severityCounts, type VulnFinding } from "../vulnFindings";

function report(opts: {
  name: string;
  ns: string;
  ownerKind: string;
  ownerName: string;
  container: string;
  vulns: { id: string; severity: string; installedVersion?: string; fixedVersion?: string; primaryLink?: string }[];
  updateTimestamp?: string;
}) {
  return {
    metadata: {
      name: opts.name,
      namespace: opts.ns,
      labels: {
        "trivy-operator.resource.kind": opts.ownerKind,
        "trivy-operator.resource.name": opts.ownerName,
        "trivy-operator.resource.namespace": opts.ns,
        "trivy-operator.container.name": opts.container,
      },
    },
    report: {
      updateTimestamp: opts.updateTimestamp,
      vulnerabilities: opts.vulns.map((v) => ({
        vulnerabilityID: v.id,
        severity: v.severity,
        installedVersion: v.installedVersion,
        fixedVersion: v.fixedVersion,
        primaryLink: v.primaryLink,
      })),
    },
  };
}

describe("findingsForPod", () => {
  it("matches a report by owner kind/name/namespace and container", () => {
    const reports = [
      report({ name: "web-abc-nginx", ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-abc", container: "nginx", vulns: [{ id: "CVE-2024-1", severity: "HIGH" }] }),
    ];
    const findings = findingsForPod(reports, { ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-abc", containers: ["nginx"] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("CVE-2024-1");
    expect(findings[0]!.container).toBe("nginx");
  });

  it("does not match a report for a different owner name", () => {
    const reports = [report({ name: "other-nginx", ns: "team-a", ownerKind: "ReplicaSet", ownerName: "other", container: "nginx", vulns: [{ id: "CVE-1", severity: "LOW" }] })];
    const findings = findingsForPod(reports, { ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-abc", containers: ["nginx"] });
    expect(findings).toEqual([]);
  });

  it("does not match a report in a different namespace", () => {
    const reports = [report({ name: "web-abc-nginx", ns: "team-b", ownerKind: "ReplicaSet", ownerName: "web-abc", container: "nginx", vulns: [{ id: "CVE-1", severity: "LOW" }] })];
    const findings = findingsForPod(reports, { ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-abc", containers: ["nginx"] });
    expect(findings).toEqual([]);
  });

  it("matches a bare pod scanned directly (kind: Pod, no controller)", () => {
    const reports = [report({ name: "standalone-app", ns: "default", ownerKind: "Pod", ownerName: "standalone", container: "app", vulns: [{ id: "CVE-2", severity: "CRITICAL" }] })];
    const findings = findingsForPod(reports, { ns: "default", ownerKind: "Pod", ownerName: "standalone", containers: ["app"] });
    expect(findings).toHaveLength(1);
  });

  it("sorts findings Critical → High → Medium → Low → Unknown", () => {
    const reports = [
      report({
        name: "web-abc-nginx",
        ns: "team-a",
        ownerKind: "ReplicaSet",
        ownerName: "web-abc",
        container: "nginx",
        vulns: [
          { id: "CVE-low", severity: "LOW" },
          { id: "CVE-crit", severity: "CRITICAL" },
          { id: "CVE-med", severity: "MEDIUM" },
          { id: "CVE-high", severity: "HIGH" },
          { id: "CVE-unk", severity: "SOMETHING-ELSE" },
        ],
      }),
    ];
    const findings = findingsForPod(reports, { ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-abc", containers: ["nginx"] });
    expect(findings.map((f) => f.id)).toEqual(["CVE-crit", "CVE-high", "CVE-med", "CVE-low", "CVE-unk"]);
  });

  it("carries the report's own update timestamp so a stale finding is never mistaken for live", () => {
    const reports = [
      report({ name: "web-abc-nginx", ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-abc", container: "nginx", vulns: [{ id: "CVE-1", severity: "HIGH" }], updateTimestamp: "2026-09-01T00:00:00Z" }),
    ];
    const findings = findingsForPod(reports, { ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-abc", containers: ["nginx"] });
    expect(findings[0]!.updatedAt).toBe("2026-09-01T00:00:00Z");
  });
});

describe("severityCounts", () => {
  it("tallies findings by severity", () => {
    const findings: VulnFinding[] = [
      { id: "a", severity: "CRITICAL", container: "x", reportName: "r" },
      { id: "b", severity: "CRITICAL", container: "x", reportName: "r" },
      { id: "c", severity: "HIGH", container: "x", reportName: "r" },
      { id: "d", severity: "LOW", container: "x", reportName: "r" },
    ];
    expect(severityCounts(findings)).toEqual({ CRITICAL: 2, HIGH: 1, MEDIUM: 0, LOW: 1, UNKNOWN: 0 });
  });
});
