import { describe, it, expect } from "vitest";
import { findingsForResource } from "../policyFindings";

function report(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "polr-ns-default", namespace: "default" },
    summary: { pass: 3, fail: 1, warn: 0, error: 0, skip: 0 },
    results: [
      {
        policy: "require-labels",
        rule: "check-team-label",
        result: "fail",
        message: "validation error: label 'team' is required",
        severity: "medium",
        category: "Best Practices",
        resources: [{ apiVersion: "apps/v1", kind: "Deployment", name: "app", namespace: "default", uid: "u1" }],
      },
      {
        policy: "require-labels",
        rule: "check-owner-label",
        result: "pass",
        resources: [{ apiVersion: "apps/v1", kind: "Deployment", name: "app", namespace: "default", uid: "u1" }],
      },
      {
        policy: "disallow-latest-tag",
        rule: "check-tag",
        result: "fail",
        message: "using image tag 'latest' is not allowed",
        resources: [{ apiVersion: "v1", kind: "Pod", name: "app-abc123", namespace: "default", uid: "u2" }],
      },
    ],
    ...overrides,
  };
}

describe("findingsForResource", () => {
  it("matches findings whose result.resources entry names this exact resource", () => {
    const findings = findingsForResource([report()], { kind: "Deployment", ns: "default", name: "app" });
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.rule).sort()).toEqual(["check-owner-label", "check-team-label"]);
  });

  it("does not match a finding for a different resource in the same report", () => {
    const findings = findingsForResource([report()], { kind: "Pod", ns: "default", name: "other-pod" });
    expect(findings).toHaveLength(0);
  });

  it("does not match across namespaces", () => {
    const findings = findingsForResource([report()], { kind: "Deployment", ns: "other-ns", name: "app" });
    expect(findings).toHaveLength(0);
  });

  it("matches a cluster-scoped resource with no namespace", () => {
    const clusterReport = report({
      metadata: { name: "cpolr-1" },
      results: [
        {
          policy: "require-labels",
          rule: "check-node-label",
          result: "fail",
          message: "node missing label",
          resources: [{ apiVersion: "v1", kind: "Node", name: "node-1" }],
        },
      ],
    });
    const findings = findingsForResource([clusterReport], { kind: "Node", ns: "", name: "node-1" });
    expect(findings).toHaveLength(1);
  });

  it("carries the message, severity, and source report name through", () => {
    const findings = findingsForResource([report()], { kind: "Deployment", ns: "default", name: "app" });
    const fail = findings.find((f) => f.result === "fail")!;
    expect(fail.message).toBe("validation error: label 'team' is required");
    expect(fail.severity).toBe("medium");
    expect(fail.policy).toBe("require-labels");
  });

  it("aggregates findings across multiple reports", () => {
    const second = report({
      metadata: { name: "polr-2", namespace: "default" },
      results: [
        {
          policy: "another-policy",
          rule: "another-rule",
          result: "warn",
          message: "heads up",
          resources: [{ apiVersion: "apps/v1", kind: "Deployment", name: "app", namespace: "default" }],
        },
      ],
    });
    const findings = findingsForResource([report(), second], { kind: "Deployment", ns: "default", name: "app" });
    expect(findings).toHaveLength(3);
  });
});
