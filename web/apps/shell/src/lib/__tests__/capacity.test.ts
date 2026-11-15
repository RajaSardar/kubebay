import { describe, expect, it } from "vitest";
import { CAPACITY_WARN_PCT, clusterCapacity } from "../capacity";

// Overview v2's capacity line: requested of allocatable, from pod specs and
// node status alone (no metrics-server); "used" only when metrics exist.

type Obj = Record<string, unknown>;

function pod(name: string, req: { cpu?: string; memory?: string }[], o: { node?: string; phase?: string; deleting?: boolean; ns?: string } = {}): Obj {
  return {
    metadata: { name, namespace: o.ns ?? "shop", ...(o.deleting ? { deletionTimestamp: "x" } : {}) },
    spec: { nodeName: o.node ?? "n1", containers: req.map((r, i) => ({ name: `c${i}`, resources: { requests: r } })) },
    status: { phase: o.phase ?? "Running" },
  };
}
function node(name: string, cpu: string, memory: string, unschedulable = false): Obj {
  return { metadata: { name }, spec: unschedulable ? { unschedulable: true } : {}, status: { allocatable: { cpu, memory } } };
}

describe("clusterCapacity", () => {
  it("sums every container's requests against every schedulable node's allocatable", () => {
    const c = clusterCapacity({
      pods: [pod("a", [{ cpu: "500m", memory: "1Gi" }, { cpu: "250m" }]), pod("b", [{ memory: "512Mi" }])],
      nodes: [node("n1", "2", "4Gi"), node("n2", "2", "4Gi"), node("cordoned", "8", "32Gi", true)],
    })!;
    expect(c.cpu).toMatchObject({ requested: 750, allocatable: 4000, pct: 19 });
    expect(c.memory).toMatchObject({ requested: 1.5 * 1024 ** 3, allocatable: 8 * 1024 ** 3, pct: 19 });
    expect(c.cpu.used).toBeUndefined();
  });

  it("leaves out finished, terminating and unscheduled pods", () => {
    const c = clusterCapacity({
      pods: [
        pod("done", [{ cpu: "1" }], { phase: "Succeeded" }),
        pod("failed", [{ cpu: "1" }], { phase: "Failed" }),
        pod("bye", [{ cpu: "1" }], { deleting: true }),
        pod("waiting", [{ cpu: "1" }], { node: "", phase: "Pending" }),
        pod("live", [{ cpu: "100m" }]),
      ],
      nodes: [node("n1", "1", "1Gi")],
    })!;
    expect(c.cpu.requested).toBe(100);
  });

  it("adds what is used when pod metrics exist", () => {
    const c = clusterCapacity({
      pods: [pod("a", [{ cpu: "1", memory: "1Gi" }])],
      nodes: [node("n1", "4", "4Gi")],
      usage: [{ namespace: "shop", name: "a", cpuMillis: 300, memBytes: 256 * 1024 ** 2 }],
    })!;
    expect(c.cpu.used).toBe(300);
    expect(c.memory.used).toBe(256 * 1024 ** 2);
  });

  it("flags a resource past the warning line, and is null with no nodes", () => {
    const c = clusterCapacity({ pods: [pod("a", [{ memory: "3.5Gi" }])], nodes: [node("n1", "1", "4Gi")] })!;
    expect(CAPACITY_WARN_PCT).toBe(85);
    expect(c.memory).toMatchObject({ pct: 88, over: true });
    expect(c.cpu.over).toBe(false);
    expect(clusterCapacity({ pods: [], nodes: [] })).toBeNull();
  });
});
