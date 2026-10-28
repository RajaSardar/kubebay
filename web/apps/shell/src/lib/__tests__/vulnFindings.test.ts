import { describe, it, expect } from "vitest";
import {
  findingsForPod,
  findingsForWorkload,
  matchesVulnQuery,
  ownerNamesForWorkload,
  severityCounts,
  vulnWorkloads,
  type VulnFinding,
} from "../vulnFindings";

function report(opts: {
  name: string;
  ns: string;
  ownerKind: string;
  ownerName: string;
  container: string;
  vulns: { id: string; severity: string; installedVersion?: string; fixedVersion?: string; primaryLink?: string; pkg?: string }[];
  updateTimestamp?: string;
  image?: { repository: string; tag: string };
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
      artifact: opts.image,
      vulnerabilities: opts.vulns.map((v) => ({
        resource: v.pkg,
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

function replicaSet(name: string, ns: string, ownerName: string) {
  return { metadata: { name, namespace: ns, ownerReferences: [{ kind: "Deployment", name: ownerName, controller: true }] } };
}

describe("ownerNamesForWorkload", () => {
  it("resolves a Deployment to its owned ReplicaSet(s), not its own name", () => {
    const rs = [replicaSet("web-abc", "team-a", "web"), replicaSet("web-def", "team-a", "web")];
    const result = ownerNamesForWorkload("Deployment", "web", "team-a", rs);
    expect(result.ownerKind).toBe("ReplicaSet");
    expect(result.ownerNames.sort()).toEqual(["web-abc", "web-def"]);
  });

  it("ignores a ReplicaSet owned by a different Deployment", () => {
    const rs = [replicaSet("other-abc", "team-a", "other")];
    const result = ownerNamesForWorkload("Deployment", "web", "team-a", rs);
    expect(result.ownerNames).toEqual([]);
  });

  it("ignores a same-named Deployment's ReplicaSet in a different namespace", () => {
    const rs = [replicaSet("web-abc", "team-b", "web")];
    const result = ownerNamesForWorkload("Deployment", "web", "team-a", rs);
    expect(result.ownerNames).toEqual([]);
  });

  it("resolves a StatefulSet/DaemonSet directly -- they are their own pods' owner, no ReplicaSet hop", () => {
    expect(ownerNamesForWorkload("StatefulSet", "db", "team-a", [])).toEqual({ ownerKind: "StatefulSet", ownerNames: ["db"] });
    expect(ownerNamesForWorkload("DaemonSet", "agent", "team-a", [])).toEqual({ ownerKind: "DaemonSet", ownerNames: ["agent"] });
  });
});

describe("findingsForWorkload", () => {
  it("aggregates findings across multiple owner names -- a Deployment mid-rollout with two ReplicaSets", () => {
    const reports = [
      report({ name: "web-abc-nginx", ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-abc", container: "nginx", vulns: [{ id: "CVE-1", severity: "HIGH" }] }),
      report({ name: "web-def-nginx", ns: "team-a", ownerKind: "ReplicaSet", ownerName: "web-def", container: "nginx", vulns: [{ id: "CVE-2", severity: "CRITICAL" }] }),
    ];
    const findings = findingsForWorkload(reports, { ns: "team-a", ownerKind: "ReplicaSet", ownerNames: ["web-abc", "web-def"] });
    expect(findings.map((f) => f.id)).toEqual(["CVE-2", "CVE-1"]);
  });

  it("does not match a report for an owner name outside the workload's set", () => {
    const reports = [report({ name: "other-nginx", ns: "team-a", ownerKind: "ReplicaSet", ownerName: "other", container: "nginx", vulns: [{ id: "CVE-1", severity: "LOW" }] })];
    const findings = findingsForWorkload(reports, { ns: "team-a", ownerKind: "ReplicaSet", ownerNames: ["web-abc"] });
    expect(findings).toEqual([]);
  });

  it("matches a StatefulSet's own reports directly by name", () => {
    const reports = [report({ name: "db-0-postgres", ns: "team-a", ownerKind: "StatefulSet", ownerName: "db", container: "postgres", vulns: [{ id: "CVE-3", severity: "MEDIUM" }] })];
    const findings = findingsForWorkload(reports, { ns: "team-a", ownerKind: "StatefulSet", ownerNames: ["db"] });
    expect(findings).toHaveLength(1);
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

// Root backlog #16: every finding on one page, a row per workload.

describe("vulnWorkloads", () => {
  const reports = [
    // web's two ReplicaSets (mid-rollout) and two containers: one row, Deployment web.
    report({ name: "web-a-nginx", ns: "shop", ownerKind: "ReplicaSet", ownerName: "web-a", container: "nginx", image: { repository: "library/nginx", tag: "1.25" },
      updateTimestamp: "2026-10-20T00:00:00Z",
      vulns: [{ id: "CVE-1", severity: "CRITICAL", pkg: "openssl", fixedVersion: "3.0.2" }, { id: "CVE-2", severity: "LOW", pkg: "zlib" }] }),
    report({ name: "web-b-sidecar", ns: "shop", ownerKind: "ReplicaSet", ownerName: "web-b", container: "sidecar", image: { repository: "envoy", tag: "1.30" },
      updateTimestamp: "2026-10-22T00:00:00Z",
      vulns: [{ id: "CVE-3", severity: "HIGH", pkg: "curl", fixedVersion: "8.5" }] }),
    // A StatefulSet owns its pods directly.
    report({ name: "db-postgres", ns: "shop", ownerKind: "StatefulSet", ownerName: "db", container: "postgres", image: { repository: "postgres", tag: "16" },
      vulns: [{ id: "CVE-4", severity: "MEDIUM", pkg: "glibc" }] }),
    // A ReplicaSet no Deployment owns stays a ReplicaSet.
    report({ name: "lone-app", ns: "ops", ownerKind: "ReplicaSet", ownerName: "lone", container: "app", vulns: [{ id: "CVE-5", severity: "CRITICAL" }, { id: "CVE-6", severity: "CRITICAL" }] }),
    // A clean scan isn't a row.
    report({ name: "clean-app", ns: "ops", ownerKind: "DaemonSet", ownerName: "clean", container: "app", vulns: [] }),
  ];
  const replicaSets = [replicaSet("web-a", "shop", "web"), replicaSet("web-b", "shop", "web")];

  it("gives each workload one row, a Deployment for its ReplicaSets' reports", () => {
    const rows = vulnWorkloads(reports, replicaSets);
    expect(rows.map((r) => `${r.ns}/${r.kind}/${r.name}`)).toEqual(["ops/ReplicaSet/lone", "shop/Deployment/web", "shop/StatefulSet/db"]);
    const web = rows.find((r) => r.name === "web")!;
    expect(web.findings.map((f) => f.id)).toEqual(["CVE-1", "CVE-3", "CVE-2"]);
    expect(web.counts).toEqual({ CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 1, UNKNOWN: 0 });
    expect(web.fixable).toBe(2);
    expect(web.images).toEqual(["envoy:1.30", "library/nginx:1.25"]);
    expect(web.scannedAt).toBe("2026-10-22T00:00:00Z");
  });

  it("puts the worst first: most critical, then high, then the rest", () => {
    // lone has 2 critical, web 1 critical and 1 high, db 1 medium.
    expect(vulnWorkloads(reports, replicaSets).map((r) => r.name)).toEqual(["lone", "web", "db"]);
  });

  it("keeps a finding's package", () => {
    const web = vulnWorkloads(reports, replicaSets).find((r) => r.name === "web")!;
    expect(web.findings.find((f) => f.id === "CVE-1")!.pkg).toBe("openssl");
  });
});

describe("matchesVulnQuery", () => {
  const web = vulnWorkloads(
    [report({ name: "web-a-nginx", ns: "shop", ownerKind: "ReplicaSet", ownerName: "web-a", container: "nginx", image: { repository: "library/nginx", tag: "1.25" },
      vulns: [{ id: "CVE-2024-6387", severity: "CRITICAL", pkg: "openssh-client" }] })],
    [replicaSet("web-a", "shop", "web")],
  )[0]!;

  it("finds a workload by its name, namespace, image, a CVE it has or a package", () => {
    for (const q of ["web", "shop", "nginx:1.25", "cve-2024-6387", "openssh", "shop web"]) expect(matchesVulnQuery(web, q), q).toBe(true);
    expect(matchesVulnQuery(web, "")).toBe(true);
    expect(matchesVulnQuery(web, "CVE-2023")).toBe(false);
    expect(matchesVulnQuery(web, "payments")).toBe(false);
  });
});
