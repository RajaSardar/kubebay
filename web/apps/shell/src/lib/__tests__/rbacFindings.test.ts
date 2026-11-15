import { describe, it, expect } from "vitest";
import { isSystemFinding, findingQuery } from "../rbacFindings";
import type { RBACFinding } from "../api";

function finding(overrides: Partial<RBACFinding> = {}): RBACFinding {
  return {
    severity: "high",
    title: "Wildcard verb (*)",
    subject: "ServiceAccount default/sa1",
    roleRef: "ClusterRole:my-role",
    why: "...",
    ...overrides,
  };
}

describe("isSystemFinding", () => {
  it("is false for an ordinary user-created role", () => {
    expect(isSystemFinding(finding({ roleRef: "ClusterRole:my-role" }))).toBe(false);
  });

  it("is true for a built-in system: ClusterRole", () => {
    expect(isSystemFinding(finding({ roleRef: "ClusterRole:system:controller:namespace-controller" }))).toBe(true);
  });

  it("is true for a namespaced Role literally named with a system: prefix", () => {
    expect(isSystemFinding(finding({ roleRef: "Role:system:something" }))).toBe(true);
  });
});

describe("findingQuery", () => {
  it("returns a verb/resource query for a finding that carries one", () => {
    const q = findingQuery(finding({ verb: "get", group: "", resource: "secrets" }));
    expect(q).toEqual({ verb: "get", group: "", resource: "secrets" });
  });

  it("returns null for a finding with no query hint (e.g. a structural finding)", () => {
    expect(findingQuery(finding({ verb: undefined, resource: undefined }))).toBeNull();
  });
});
