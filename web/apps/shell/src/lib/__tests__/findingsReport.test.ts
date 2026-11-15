import { describe, it, expect } from "vitest";
import Ajv from "ajv-draft-04";
import addFormats from "ajv-formats";
import { buildFindingsReport, reportToJSON, reportToMarkdown, reportToSARIF, type DetectorFindings } from "../findingsReport";
import type { AttackPath } from "../attackPaths";
// The OASIS SARIF 2.1.0 schema (errata 01), as published.
import sarifSchema from "./fixtures/sarif-schema-2.1.0.json?raw";

const attackPath: AttackPath = {
  workload: { ns: "shop", kind: "Deployment", name: "api" },
  serviceAccount: "api",
  entry: [{ via: "LoadBalancer", name: "api-public" }],
  ingressIsolated: false,
  isolatingPolicies: [],
  vulns: { critical: 1, high: 0 },
  tokenMounted: true,
  privileges: [{ title: "Cluster-wide Secret read access", severity: "high", roleRef: "ClusterRole:secret-reader" }],
  nodeEscape: [],
  secretAccess: ["every namespace"],
  complete: true,
  score: 9,
  steps: ["Reachable from outside through LoadBalancer api-public", "Its token can read Secrets in every namespace"],
};

export const fixture: DetectorFindings = {
  spof: [{ kind: "no-pdb", ns: "shop", name: "api", workloadKind: "Deployment", detail: "1 replica and no PodDisruptionBudget" }],
  netpolGaps: [{ namespace: "shop", appLabel: "api", podCount: 2, reason: "no-policy-in-namespace" }],
  rbac: [
    { severity: "high", title: "Bound to the built-in cluster-admin role", subject: "ServiceAccount ci/deployer", roleRef: "ClusterRole:cluster-admin", why: "cluster-admin can do anything in any namespace." },
  ],
  secretEnv: [{ namespace: "shop", appLabel: "api", podCount: 2, secretNames: ["db-creds"] }],
  automount: [{ namespace: "shop", appLabel: "web", podCount: 3 }],
  upgrade: [{ kind: "PodDisruptionBudget", apiVersion: "policy/v1beta1", replacementVersion: "policy/v1", removedInMinor: 25, minorsAway: 1 }],
  unenforcedSignatureNamespaces: ["shop"],
  attackPaths: [attackPath],
};

const report = () => buildFindingsReport({ cluster: "kind-dev", kubebayVersion: "v0.7.0", generatedAt: "2026-10-13T10:00:00.000Z", findings: fixture });

describe("findings report (KB-15)", () => {
  it("records the cluster, the time and the Kubebay version", () => {
    const r = report();
    expect(r.cluster).toBe("kind-dev");
    expect(r.generatedAt).toBe("2026-10-13T10:00:00.000Z");
    expect(r.tool).toEqual({ name: "Kubebay", version: "v0.7.0" });
  });

  it("turns every detector's findings into one list, with framework controls", () => {
    const r = report();
    const by = (rule: string) => r.findings.find((f) => f.ruleId === rule)!;
    expect(r.findings.map((f) => f.ruleId)).toEqual([
      "kubebay.attack-path",
      "kubebay.rbac.cluster-admin-binding",
      "kubebay.upgrade.removed-api",
      "kubebay.spof.no-pdb",
      "kubebay.netpol.uncovered",
      "kubebay.secret-env",
      "kubebay.sa-token.automount",
      "kubebay.signatures.unenforced",
    ]);
    expect(by("kubebay.attack-path").severity).toBe("high");
    expect(by("kubebay.rbac.cluster-admin-binding").controls.map((c) => c.id)).toEqual(["5.1.1"]);
    expect(by("kubebay.netpol.uncovered").controls.map((c) => c.id)).toEqual(["5.3.2"]);
    expect(by("kubebay.sa-token.automount").controls.map((c) => c.id)).toEqual(["5.1.5", "5.1.6", "T1528"]);
    expect(by("kubebay.signatures.unenforced").controls.map((c) => c.id)).toEqual(["5.5.1", "T1525"]);
    expect(by("kubebay.spof.no-pdb").resource).toEqual({ kind: "Deployment", namespace: "shop", name: "api" });
  });

  it("matches the golden JSON", async () => {
    await expect(reportToJSON(report())).toMatchFileSnapshot("./golden/findings-report.json");
  });

  it("matches the golden Markdown", async () => {
    await expect(reportToMarkdown(report())).toMatchFileSnapshot("./golden/findings-report.md");
  });

  it("matches the golden SARIF, which is valid SARIF 2.1.0", async () => {
    const sarif = reportToSARIF(report());
    await expect(sarif).toMatchFileSnapshot("./golden/findings-report.sarif");
    const schema = JSON.parse(sarifSchema);
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(JSON.parse(sarif));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it("says so when there is nothing to report", () => {
    const empty = buildFindingsReport({ cluster: "c", kubebayVersion: "dev", generatedAt: "2026-10-13T10:00:00.000Z", findings: {} });
    expect(empty.findings).toEqual([]);
    expect(reportToMarkdown(empty)).toContain("No findings.");
    expect(JSON.parse(reportToSARIF(empty)).runs[0].results).toEqual([]);
  });
});
