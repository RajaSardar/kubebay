import { describe, it, expect } from "vitest";
import { computeNodePoolImpact } from "../karpenterImpact";

function node(name: string, opts: { nodepool?: string; capacityType?: string } = {}) {
  return {
    metadata: {
      name,
      labels: {
        ...(opts.nodepool ? { "karpenter.sh/nodepool": opts.nodepool } : {}),
        ...(opts.capacityType ? { "karpenter.sh/capacity-type": opts.capacityType } : {}),
      },
    },
  };
}

function pod(ns: string, name: string, nodeName: string, labels: Record<string, string> = {}) {
  return { metadata: { namespace: ns, name, labels }, spec: { nodeName } };
}

function pdb(ns: string, name: string, matchLabels: Record<string, string>) {
  return { metadata: { namespace: ns, name }, spec: { selector: { matchLabels } } };
}

describe("computeNodePoolImpact", () => {
  it("counts nodes, pods, and namespaces backed by this pool", () => {
    const nodes = [node("n1", { nodepool: "default" }), node("n2", { nodepool: "default" })];
    const pods = [pod("team-a", "p1", "n1"), pod("team-a", "p2", "n1"), pod("team-b", "p3", "n2")];
    const impact = computeNodePoolImpact("default", nodes, pods, []);
    expect(impact.nodeCount).toBe(2);
    expect(impact.podCount).toBe(3);
    expect(impact.namespaceCount).toBe(2);
  });

  it("counts spot nodes", () => {
    const nodes = [node("n1", { nodepool: "default", capacityType: "spot" }), node("n2", { nodepool: "default", capacityType: "on-demand" })];
    const impact = computeNodePoolImpact("default", nodes, [], []);
    expect(impact.spotCount).toBe(1);
  });

  it("counts pods actually covered by a PDB's selector, not just same-namespace", () => {
    const nodes = [node("n1", { nodepool: "default" })];
    const pods = [
      pod("team-a", "p1", "n1", { app: "web" }),
      pod("team-a", "p2", "n1", { app: "worker" }),
    ];
    const pdbs = [pdb("team-a", "web-pdb", { app: "web" })];
    const impact = computeNodePoolImpact("default", nodes, pods, pdbs);
    expect(impact.pdbProtectedPodCount).toBe(1);
  });

  it("does not count a PDB in a different namespace", () => {
    const nodes = [node("n1", { nodepool: "default" })];
    const pods = [pod("team-a", "p1", "n1", { app: "web" })];
    const pdbs = [pdb("team-b", "web-pdb", { app: "web" })];
    const impact = computeNodePoolImpact("default", nodes, pods, pdbs);
    expect(impact.pdbProtectedPodCount).toBe(0);
  });

  it("ignores nodes/pods belonging to a different NodePool", () => {
    const nodes = [node("n1", { nodepool: "default" }), node("n2", { nodepool: "other" })];
    const pods = [pod("team-a", "p1", "n1"), pod("team-a", "p2", "n2")];
    const impact = computeNodePoolImpact("default", nodes, pods, []);
    expect(impact.nodeCount).toBe(1);
    expect(impact.podCount).toBe(1);
  });
});
