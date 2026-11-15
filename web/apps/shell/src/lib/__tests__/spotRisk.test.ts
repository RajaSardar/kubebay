import { describe, it, expect } from "vitest";
import { isSpotNode, findSpotRiskWorkloads } from "../spotRisk";

function node(name: string, labels: Record<string, string> = {}) {
  return { metadata: { name, labels } };
}
function pod(ns: string, name: string, labels: Record<string, string>, nodeName: string, ownerKind = "ReplicaSet") {
  return {
    metadata: { namespace: ns, name, labels, ownerReferences: [{ kind: ownerKind, name: `${name}-owner`, controller: true }] },
    spec: { nodeName },
    status: { phase: "Running" },
  };
}
function pdb(ns: string, matchLabels: Record<string, string>) {
  return { metadata: { namespace: ns, name: "pdb" }, spec: { selector: { matchLabels } } };
}

describe("isSpotNode", () => {
  it.each([
    [{ "karpenter.sh/capacity-type": "spot" }],
    [{ "eks.amazonaws.com/capacityType": "SPOT" }],
    [{ "cloud.google.com/gke-spot": "true" }],
    [{ "cloud.google.com/gke-preemptible": "true" }],
    [{ "kubernetes.azure.com/scalesetpriority": "spot" }],
  ])("recognizes %o as spot", (labels) => {
    expect(isSpotNode(node("n", labels))).toBe(true);
  });

  it("treats on-demand and unlabelled nodes as not spot", () => {
    expect(isSpotNode(node("n", { "karpenter.sh/capacity-type": "on-demand" }))).toBe(false);
    expect(isSpotNode(node("n"))).toBe(false);
  });
});

describe("findSpotRiskWorkloads", () => {
  const spot = node("spot-1", { "karpenter.sh/capacity-type": "spot" });
  const spot2 = node("spot-2", { "karpenter.sh/capacity-type": "spot" });
  const onDemand = node("od-1", { "karpenter.sh/capacity-type": "on-demand" });

  it("flags a single-replica workload running on a spot node", () => {
    const findings = findSpotRiskWorkloads([pod("shop", "cart-1", { app: "cart" }, "spot-1")], [spot], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ namespace: "shop", appLabel: "cart", podCount: 1, reason: "single-replica-on-spot" });
  });

  it("flags a multi-replica workload entirely on spot with no covering PDB", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, "spot-1"), pod("shop", "cart-2", { app: "cart" }, "spot-2")];
    const findings = findSpotRiskWorkloads(pods, [spot, spot2], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ podCount: 2, reason: "no-pdb-on-spot" });
  });

  it("does not flag a multi-replica spot workload that a PDB covers", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, "spot-1"), pod("shop", "cart-2", { app: "cart" }, "spot-2")];
    expect(findSpotRiskWorkloads(pods, [spot, spot2], [pdb("shop", { app: "cart" })])).toHaveLength(0);
  });

  it("still flags a single-replica spot workload even when a PDB covers it -- a PDB cannot stop a spot reclaim", () => {
    const findings = findSpotRiskWorkloads([pod("shop", "cart-1", { app: "cart" }, "spot-1")], [spot], [pdb("shop", { app: "cart" })]);
    expect(findings[0]?.reason).toBe("single-replica-on-spot");
  });

  it("does not flag a workload with at least one replica on an on-demand node", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, "spot-1"), pod("shop", "cart-2", { app: "cart" }, "od-1")];
    expect(findSpotRiskWorkloads(pods, [spot, onDemand], [])).toHaveLength(0);
  });

  it("ignores DaemonSet pods -- they run per node by design", () => {
    expect(findSpotRiskWorkloads([pod("kube-system", "agent-1", { app: "agent" }, "spot-1", "DaemonSet")], [spot], [])).toHaveLength(0);
  });

  it("ignores pods that are not running or not yet scheduled", () => {
    const pending = { ...pod("shop", "cart-1", { app: "cart" }, ""), status: { phase: "Pending" } };
    const done = { ...pod("shop", "job-1", { app: "job" }, "spot-1"), status: { phase: "Succeeded" } };
    expect(findSpotRiskWorkloads([pending, done], [spot], [])).toHaveLength(0);
  });

  it("only matches a PDB in the same namespace", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, "spot-1"), pod("shop", "cart-2", { app: "cart" }, "spot-2")];
    expect(findSpotRiskWorkloads(pods, [spot, spot2], [pdb("other", { app: "cart" })])).toHaveLength(1);
  });

  it("returns nothing when the cluster has no spot nodes", () => {
    expect(findSpotRiskWorkloads([pod("shop", "cart-1", { app: "cart" }, "od-1")], [onDemand], [])).toEqual([]);
  });
});
