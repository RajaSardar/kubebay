import { describe, expect, it } from "vitest";
import { podsOfWorkloadPath, selectorString } from "../selector";

// #23 "Show pods": a workload's spec.selector as a Kubernetes label selector
// string, and the Pods URL that streams exactly those pods.

describe("selectorString", () => {
  it("joins matchLabels as key=value", () => {
    expect(selectorString({ matchLabels: { app: "web", tier: "frontend" } })).toBe("app=web,tier=frontend");
  });

  it("writes matchExpressions in set-based form", () => {
    expect(
      selectorString({
        matchLabels: { app: "web" },
        matchExpressions: [
          { key: "env", operator: "In", values: ["prod", "staging"] },
          { key: "canary", operator: "NotIn", values: ["true"] },
          { key: "team", operator: "Exists" },
          { key: "legacy", operator: "DoesNotExist" },
        ],
      }),
    ).toBe("app=web,env in (prod,staging),canary notin (true),team,!legacy");
  });

  it("is empty when there is nothing to select on", () => {
    expect(selectorString(undefined)).toBe("");
    expect(selectorString({})).toBe("");
  });
});

describe("podsOfWorkloadPath", () => {
  it("links to Pods for the workload's namespace and selector", () => {
    const deploy = {
      kind: "Deployment",
      metadata: { name: "web", namespace: "shop" },
      spec: { selector: { matchLabels: { app: "web" } } },
    };
    expect(podsOfWorkloadPath(deploy, "Deployment")).toBe("/workloads?ns=shop&selector=app%3Dweb&of=Deployment%2Fweb");
  });

  it("has no link when the workload selects nothing", () => {
    expect(podsOfWorkloadPath({ metadata: { name: "x", namespace: "a" }, spec: {} }, "Job")).toBeNull();
  });
});
