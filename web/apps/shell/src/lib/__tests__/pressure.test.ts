import { describe, it, expect } from "vitest";
import { aggregatePressure } from "../pressure";
import type { PodUsage } from "../api";

function node(name: string, cpu = "4", mem = "16Gi") {
  return { metadata: { name }, status: { allocatable: { cpu, memory: mem } } };
}

function pod(ns: string, name: string, nodeName: string, containers: { cpu?: string; memory?: string }[]) {
  return {
    metadata: { namespace: ns, name },
    spec: {
      nodeName,
      containers: containers.map((c, i) => ({
        name: `c${i}`,
        resources: { requests: { ...(c.cpu ? { cpu: c.cpu } : {}), ...(c.memory ? { memory: c.memory } : {}) } },
      })),
    },
  };
}

describe("aggregatePressure", () => {
  it("aggregates requested cpu/mem per namespace x node cell", () => {
    const nodes = [node("node-1")];
    const pods = [pod("team-a", "p1", "node-1", [{ cpu: "500m", memory: "1Gi" }])];
    const g = aggregatePressure(pods, nodes, []);
    const cell = g.cells.find((c) => c.ns === "team-a" && c.node === "node-1");
    expect(cell?.requestedCpuMillis).toBe(500);
    expect(cell?.requestedMemBytes).toBe(1024 ** 3);
    expect(cell?.podCount).toBe(1);
  });

  it("sums multiple pods in the same namespace on the same node", () => {
    const nodes = [node("node-1")];
    const pods = [
      pod("team-a", "p1", "node-1", [{ cpu: "500m" }]),
      pod("team-a", "p2", "node-1", [{ cpu: "300m" }]),
    ];
    const g = aggregatePressure(pods, nodes, []);
    const cell = g.cells.find((c) => c.ns === "team-a" && c.node === "node-1");
    expect(cell?.requestedCpuMillis).toBe(800);
    expect(cell?.podCount).toBe(2);
  });

  it("flags a pod with no requests on any container as BestEffort", () => {
    const nodes = [node("node-1")];
    const pods = [pod("team-a", "p1", "node-1", [{}])];
    const g = aggregatePressure(pods, nodes, []);
    const cell = g.cells.find((c) => c.ns === "team-a" && c.node === "node-1");
    expect(cell?.bestEffortCount).toBe(1);
  });

  it("does not flag a pod that has at least one request set", () => {
    const nodes = [node("node-1")];
    const pods = [pod("team-a", "p1", "node-1", [{ cpu: "100m" }])];
    const g = aggregatePressure(pods, nodes, []);
    const cell = g.cells.find((c) => c.ns === "team-a" && c.node === "node-1");
    expect(cell?.bestEffortCount).toBe(0);
  });

  it("joins usage samples by namespace+name and reports hasUsageData", () => {
    const nodes = [node("node-1")];
    const pods = [pod("team-a", "p1", "node-1", [{ cpu: "500m" }])];
    const usage: PodUsage[] = [{ namespace: "team-a", name: "p1", cpuMillis: 120, memBytes: 200 }];
    const g = aggregatePressure(pods, nodes, usage);
    const cell = g.cells.find((c) => c.ns === "team-a" && c.node === "node-1");
    expect(cell?.usedCpuMillis).toBe(120);
    expect(g.hasUsageData).toBe(true);
  });

  it("reports hasUsageData: false when no usage samples are given", () => {
    const g = aggregatePressure([pod("team-a", "p1", "node-1", [{ cpu: "1" }])], [node("node-1")], []);
    expect(g.hasUsageData).toBe(false);
  });

  it("skips unscheduled pods", () => {
    const pods = [{ metadata: { namespace: "team-a", name: "p1" }, spec: { containers: [] } }];
    const g = aggregatePressure(pods, [node("node-1")], []);
    expect(g.cells).toHaveLength(0);
  });

  it("caps namespaces at the given top-N by consumption and rolls the rest into a single bucket", () => {
    const nodes = [node("node-1", "100", "400Gi")];
    const pods = [
      pod("big", "p1", "node-1", [{ cpu: "10" }]),
      pod("small-1", "p2", "node-1", [{ cpu: "1" }]),
      pod("small-2", "p3", "node-1", [{ cpu: "1" }]),
    ];
    const g = aggregatePressure(pods, nodes, [], { topNamespaces: 1, topNodes: 25 });
    expect(g.namespaces).toEqual(["big"]);
    expect(g.otherNamespacesCount).toBe(2);
    const otherCell = g.cells.find((c) => c.ns === g.otherNamespacesLabel);
    expect(otherCell?.requestedCpuMillis).toBe(2000);
  });

  it("exposes node allocatable for intensity normalization", () => {
    const g = aggregatePressure([], [node("node-1", "4", "16Gi")], []);
    expect(g.nodeAllocatable["node-1"]?.cpuMillis).toBe(4000);
  });
});
