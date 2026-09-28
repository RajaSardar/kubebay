import { describe, it, expect } from "vitest";
import { detectDangerousChanges } from "../karpenterDangerousChange";

function nodePoolYaml(opts: {
  cpu?: string;
  memory?: string;
  consolidationPolicy?: string;
  budgetNodes?: string[];
}): string {
  const budgets = (opts.budgetNodes ?? ["10%"])
    .map((n) => `      - nodes: "${n}"\n        schedule: "@daily"`)
    .join("\n");
  return `apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  limits:
    cpu: ${opts.cpu ?? "1000"}
    memory: ${opts.memory ?? "1000Gi"}
  disruption:
    consolidationPolicy: ${opts.consolidationPolicy ?? "WhenEmpty"}
    budgets:
${budgets}
  template:
    spec:
      requirements:
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
`;
}

describe("detectDangerousChanges", () => {
  it("returns no findings when nothing dangerous changed", () => {
    const yaml = nodePoolYaml({});
    expect(detectDangerousChanges(yaml, yaml)).toEqual([]);
  });

  it("flags shrinking spec.limits.cpu", () => {
    const before = nodePoolYaml({ cpu: "1000" });
    const after = nodePoolYaml({ cpu: "500" });
    const findings = detectDangerousChanges(before, after);
    expect(findings.some((f) => f.kind === "limits-shrunk-cpu")).toBe(true);
  });

  it("does not flag growing spec.limits.cpu", () => {
    const before = nodePoolYaml({ cpu: "500" });
    const after = nodePoolYaml({ cpu: "1000" });
    const findings = detectDangerousChanges(before, after);
    expect(findings.some((f) => f.kind === "limits-shrunk-cpu")).toBe(false);
  });

  it("flags shrinking spec.limits.memory", () => {
    const before = nodePoolYaml({ memory: "1000Gi" });
    const after = nodePoolYaml({ memory: "500Gi" });
    const findings = detectDangerousChanges(before, after);
    expect(findings.some((f) => f.kind === "limits-shrunk-memory")).toBe(true);
  });

  it("flags lowering a disruption budget's nodes value", () => {
    const before = nodePoolYaml({ budgetNodes: ["10%"] });
    const after = nodePoolYaml({ budgetNodes: ["5%"] });
    const findings = detectDangerousChanges(before, after);
    expect(findings.some((f) => f.kind === "budget-nodes-lowered")).toBe(true);
  });

  it("does not flag raising a disruption budget's nodes value", () => {
    const before = nodePoolYaml({ budgetNodes: ["10%"] });
    const after = nodePoolYaml({ budgetNodes: ["20%"] });
    const findings = detectDangerousChanges(before, after);
    expect(findings.some((f) => f.kind === "budget-nodes-lowered")).toBe(false);
  });

  it("flags switching consolidationPolicy to WhenEmptyOrUnderutilized", () => {
    const before = nodePoolYaml({ consolidationPolicy: "WhenEmpty" });
    const after = nodePoolYaml({ consolidationPolicy: "WhenEmptyOrUnderutilized" });
    const findings = detectDangerousChanges(before, after);
    expect(findings.some((f) => f.kind === "consolidation-policy-to-when-empty-or-underutilized")).toBe(true);
  });

  it("does not flag consolidationPolicy staying the same", () => {
    const yaml = nodePoolYaml({ consolidationPolicy: "WhenEmptyOrUnderutilized" });
    const findings = detectDangerousChanges(yaml, yaml);
    expect(findings.some((f) => f.kind === "consolidation-policy-to-when-empty-or-underutilized")).toBe(false);
  });

  it("reports multiple simultaneous dangerous changes", () => {
    const before = nodePoolYaml({ cpu: "1000", consolidationPolicy: "WhenEmpty" });
    const after = nodePoolYaml({ cpu: "500", consolidationPolicy: "WhenEmptyOrUnderutilized" });
    const findings = detectDangerousChanges(before, after);
    expect(findings.length).toBe(2);
  });

  it("each finding has a human-readable message", () => {
    const before = nodePoolYaml({ cpu: "1000" });
    const after = nodePoolYaml({ cpu: "500" });
    const findings = detectDangerousChanges(before, after);
    expect(findings[0]?.message.length).toBeGreaterThan(0);
  });
});
