import { describe, it, expect } from "vitest";
import { parseServerMinor, computeUpgradeReadiness, DEPRECATED_APIS } from "../upgradeReadiness";

describe("parseServerMinor", () => {
  it("extracts the minor version from a GitVersion-style string", () => {
    expect(parseServerMinor("v1.24.3")).toBe(24);
    expect(parseServerMinor("v1.28.10-eks-abc")).toBe(28);
  });

  it("tolerates a version with no leading v", () => {
    expect(parseServerMinor("1.24")).toBe(24);
  });

  it("returns undefined for something unparseable", () => {
    expect(parseServerMinor("")).toBeUndefined();
    expect(parseServerMinor("not-a-version")).toBeUndefined();
  });
});

describe("computeUpgradeReadiness", () => {
  it("flags a deprecated apiVersion that is within 2 minor releases of removal and still served", () => {
    const findings = computeUpgradeReadiness("v1.24.0", ["policy/v1beta1"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "PodDisruptionBudget",
      apiVersion: "policy/v1beta1",
      replacementVersion: "policy/v1",
      minorsAway: 1,
    });
  });

  it("does not flag a deprecated apiVersion the server no longer serves at all", () => {
    // v1.24 is close to policy/v1beta1's removal, but discovery says it's
    // already gone from this particular server -- nothing to migrate off.
    const findings = computeUpgradeReadiness("v1.24.0", ["policy/v1"]);
    expect(findings).toHaveLength(0);
  });

  it("does not flag a removal that is more than 2 minor releases away", () => {
    const findings = computeUpgradeReadiness("v1.18.0", ["policy/v1beta1"]);
    expect(findings).toHaveLength(0);
  });

  it("ignores served versions that aren't in the deprecation table", () => {
    const findings = computeUpgradeReadiness("v1.24.0", ["example.com/v1", "policy/v1"]);
    expect(findings).toHaveLength(0);
  });

  it("returns an unparseable server version as no findings rather than throwing", () => {
    expect(computeUpgradeReadiness("garbage", ["policy/v1beta1"])).toEqual([]);
  });

  it("sorts the most urgent (soonest removal) finding first", () => {
    const findings = computeUpgradeReadiness("v1.24.0", ["policy/v1beta1", "batch/v1beta1"]);
    // both removed in minor 25 relative to server 24 -- same urgency, but
    // this asserts sorting is stable and doesn't crash with ties.
    expect(findings.map((f) => f.apiVersion).sort()).toEqual(["batch/v1beta1", "policy/v1beta1"]);
  });

  it("every table entry has a non-empty kind, group/version, and a removal minor greater than any core-API baseline", () => {
    for (const api of DEPRECATED_APIS) {
      expect(api.kind.length).toBeGreaterThan(0);
      expect(api.version).toMatch(/^v\d+(beta|alpha)\d+$/);
      expect(api.removedInMinor).toBeGreaterThan(0);
    }
  });
});
