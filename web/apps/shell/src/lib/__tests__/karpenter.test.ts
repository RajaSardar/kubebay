import { describe, it, expect } from "vitest";
import { detectKarpenter, buildNodePoolRows, buildUnschedulablePods } from "../karpenter";
import type { CRDEntry } from "../api";

function crd(overrides: Partial<CRDEntry> = {}): CRDEntry {
  return {
    name: "nodepools.karpenter.sh",
    group: "karpenter.sh",
    version: "v1",
    resource: "nodepools",
    kind: "NodePool",
    namespaced: false,
    gvr: "karpenter.sh/v1/nodepools",
    columns: [],
    ...overrides,
  };
}

function nodePool(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "default" },
    spec: { limits: { cpu: "1000", memory: "1000Gi" } },
    status: { resources: { cpu: "8", memory: "32Gi" } },
    ...overrides,
  };
}

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

function pod(ns: string, name: string, nodeName: string) {
  return { metadata: { namespace: ns, name }, spec: { nodeName } };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { namespace: "default", name: "ev1" },
    reason: "FailedScheduling",
    message: "0/3 nodes are available: 3 Insufficient cpu.",
    count: 5,
    lastTimestamp: "2026-09-27T10:00:00Z",
    involvedObject: { kind: "Pod", name: "p1", namespace: "default" },
    ...overrides,
  };
}

describe("detectKarpenter", () => {
  it("detects Karpenter's NodePool and NodeClaim CRDs regardless of served version", () => {
    const crds = [crd(), crd({ name: "nodeclaims.karpenter.sh", resource: "nodeclaims", kind: "NodeClaim", gvr: "karpenter.sh/v1/nodeclaims" })];
    const d = detectKarpenter(crds);
    expect(d.installed).toBe(true);
    expect(d.nodePoolGvr).toBe("karpenter.sh/v1/nodepools");
    expect(d.nodeClaimGvr).toBe("karpenter.sh/v1/nodeclaims");
  });

  it("detects an older v1beta1 install without hardcoding the version", () => {
    const crds = [crd({ version: "v1beta1", gvr: "karpenter.sh/v1beta1/nodepools" })];
    const d = detectKarpenter(crds);
    expect(d.nodePoolGvr).toBe("karpenter.sh/v1beta1/nodepools");
  });

  it("reports not installed when no karpenter.sh CRDs are present", () => {
    const d = detectKarpenter([crd({ group: "keda.sh", gvr: "keda.sh/v1alpha1/scaledobjects" })]);
    expect(d.installed).toBe(false);
  });
});

describe("buildNodePoolRows", () => {
  it("joins nodes to their NodePool via the karpenter.sh/nodepool label", () => {
    const nodes = [node("n1", { nodepool: "default", capacityType: "spot" }), node("n2", { nodepool: "default", capacityType: "on-demand" })];
    const rows = buildNodePoolRows([nodePool()], nodes, []);
    expect(rows[0]!.nodeCount).toBe(2);
    expect(rows[0]!.spotCount).toBe(1);
    expect(rows[0]!.onDemandCount).toBe(1);
  });

  it("counts pods scheduled on a NodePool's nodes", () => {
    const nodes = [node("n1", { nodepool: "default" })];
    const pods = [pod("team-a", "p1", "n1"), pod("team-a", "p2", "n1"), pod("team-b", "p3", "other-node")];
    const rows = buildNodePoolRows([nodePool()], nodes, pods);
    expect(rows[0]!.podCount).toBe(2);
    expect(rows[0]!.namespaceCount).toBe(1);
  });

  it("reads limits and current resources straight off the NodePool status", () => {
    const rows = buildNodePoolRows([nodePool()], [], []);
    expect(rows[0]!.limitCpuMillis).toBe(1000 * 1000);
    expect(rows[0]!.usedCpuMillis).toBe(8000);
  });

  it("does not attribute a node with no nodepool label to any NodePool", () => {
    const rows = buildNodePoolRows([nodePool()], [node("unmanaged")], []);
    expect(rows[0]!.nodeCount).toBe(0);
  });
});

describe("buildUnschedulablePods", () => {
  it("extracts FailedScheduling events with the message quoted verbatim", () => {
    const rows = buildUnschedulablePods([event()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message).toBe("0/3 nodes are available: 3 Insufficient cpu.");
    expect(rows[0]!.pod).toBe("p1");
  });

  it("ignores events with a different reason", () => {
    const rows = buildUnschedulablePods([event({ reason: "Scheduled" })]);
    expect(rows).toHaveLength(0);
  });

  it("sorts by lastTimestamp, most recent first", () => {
    const older = event({ lastTimestamp: "2026-09-27T09:00:00Z", involvedObject: { kind: "Pod", name: "old", namespace: "default" } });
    const newer = event({ lastTimestamp: "2026-09-27T11:00:00Z", involvedObject: { kind: "Pod", name: "new", namespace: "default" } });
    const rows = buildUnschedulablePods([older, newer]);
    expect(rows.map((r) => r.pod)).toEqual(["new", "old"]);
  });
});
