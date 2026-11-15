import { describe, it, expect } from "vitest";
import { detectTrivyOperator } from "../trivyOperator";
import type { CRDEntry } from "../api";

function crd(overrides: Partial<CRDEntry>): CRDEntry {
  return {
    name: "vulnerabilityreports.aquasecurity.github.io",
    group: "aquasecurity.github.io",
    version: "v1alpha1",
    resource: "vulnerabilityreports",
    kind: "VulnerabilityReport",
    namespaced: true,
    gvr: "aquasecurity.github.io/v1alpha1/vulnerabilityreports",
    columns: [],
    ...overrides,
  };
}

describe("detectTrivyOperator", () => {
  it("reports not installed when the CRD is absent", () => {
    expect(detectTrivyOperator([])).toEqual({ installed: false, vulnerabilityReportGvr: undefined, clusterVulnerabilityReportGvr: undefined });
  });

  it("detects VulnerabilityReport and reads its GVR from discovery rather than hardcoding it", () => {
    const crds = [crd({ version: "v1alpha2", gvr: "aquasecurity.github.io/v1alpha2/vulnerabilityreports" })];
    const d = detectTrivyOperator(crds);
    expect(d.installed).toBe(true);
    expect(d.vulnerabilityReportGvr).toBe("aquasecurity.github.io/v1alpha2/vulnerabilityreports");
  });

  it("also detects the cluster-scoped ClusterVulnerabilityReport CRD independently", () => {
    const crds = [
      crd({}),
      crd({
        name: "clustervulnerabilityreports.aquasecurity.github.io",
        resource: "clustervulnerabilityreports",
        kind: "ClusterVulnerabilityReport",
        namespaced: false,
        gvr: "aquasecurity.github.io/v1alpha1/clustervulnerabilityreports",
      }),
    ];
    const d = detectTrivyOperator(crds);
    expect(d.clusterVulnerabilityReportGvr).toBe("aquasecurity.github.io/v1alpha1/clustervulnerabilityreports");
  });

  it("ignores a same-named resource from an unrelated group", () => {
    const crds = [crd({ group: "example.com", gvr: "example.com/v1/vulnerabilityreports" })];
    expect(detectTrivyOperator(crds).installed).toBe(false);
  });
});
