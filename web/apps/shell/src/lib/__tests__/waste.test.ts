import { describe, it, expect } from "vitest";
import { computeClusterWaste } from "../waste";

function node(name: string, cpu: string, mem: string) {
  return {
    metadata: { name },
    status: { allocatable: { cpu, memory: mem } },
  };
}

function pod(opts: {
  ns: string;
  name: string;
  node: string;
  containers: { name: string; cpu?: string; memory?: string }[];
  daemonSet?: boolean;
  scheduled?: boolean;
}) {
  return {
    metadata: {
      namespace: opts.ns,
      name: opts.name,
      ownerReferences: opts.daemonSet ? [{ kind: "DaemonSet", name: "ds" }] : [],
    },
    spec: {
      nodeName: opts.scheduled === false ? undefined : opts.node,
      containers: opts.containers.map((c) => ({
        name: c.name,
        resources: { requests: { ...(c.cpu ? { cpu: c.cpu } : {}), ...(c.memory ? { memory: c.memory } : {}) } },
      })),
    },
  };
}

describe("computeClusterWaste", () => {
  it("computes per-node idle as allocatable minus the sum of scheduled pod requests", () => {
    const nodes = [node("node-1", "4", "16Gi")];
    const pods = [
      pod({ ns: "team-a", name: "p1", node: "node-1", containers: [{ name: "c", cpu: "1", memory: "4Gi" }] }),
    ];
    const w = computeClusterWaste(nodes, pods);
    const n = w.nodes[0]!;
    expect(n.allocatableCpuMillis).toBe(4000);
    expect(n.requestedCpuMillis).toBe(1000);
    expect(n.idleCpuMillis).toBe(3000);
    expect(n.idleMemBytes).toBe(12 * 1024 ** 3);
  });

  it("puts DaemonSet-owned pod requests into system overhead, not a namespace bucket", () => {
    const nodes = [node("node-1", "4", "16Gi")];
    const pods = [
      pod({ ns: "kube-system", name: "ds-pod", node: "node-1", daemonSet: true, containers: [{ name: "c", cpu: "200m", memory: "256Mi" }] }),
    ];
    const w = computeClusterWaste(nodes, pods);
    expect(w.totalSystemOverheadCpuMillis).toBe(200);
    expect(w.byNamespace.find((n) => n.ns === "kube-system")).toBeUndefined();
  });

  it("aggregates per-namespace requests across multiple nodes", () => {
    const nodes = [node("node-1", "4", "16Gi"), node("node-2", "4", "16Gi")];
    const pods = [
      pod({ ns: "team-a", name: "p1", node: "node-1", containers: [{ name: "c", cpu: "1", memory: "1Gi" }] }),
      pod({ ns: "team-a", name: "p2", node: "node-2", containers: [{ name: "c", cpu: "500m", memory: "512Mi" }] }),
    ];
    const w = computeClusterWaste(nodes, pods);
    const teamA = w.byNamespace.find((n) => n.ns === "team-a");
    expect(teamA?.cpuMillis).toBe(1500);
  });

  it("flags a container with no cpu or memory requests set", () => {
    const nodes = [node("node-1", "4", "16Gi")];
    const pods = [pod({ ns: "team-a", name: "p1", node: "node-1", containers: [{ name: "unrequested" }] })];
    const w = computeClusterWaste(nodes, pods);
    expect(w.unrequestedContainers).toHaveLength(1);
    expect(w.unrequestedContainers[0]!.container).toBe("unrequested");
  });

  it("does not flag a container that only sets memory (still partially requested)", () => {
    const nodes = [node("node-1", "4", "16Gi")];
    const pods = [pod({ ns: "team-a", name: "p1", node: "node-1", containers: [{ name: "c", memory: "1Gi" }] })];
    const w = computeClusterWaste(nodes, pods);
    expect(w.unrequestedContainers).toHaveLength(0);
  });

  it("skips unscheduled pods (no nodeName) when attributing node capacity", () => {
    const nodes = [node("node-1", "4", "16Gi")];
    const pods = [pod({ ns: "team-a", name: "pending", node: "node-1", scheduled: false, containers: [{ name: "c", cpu: "1", memory: "1Gi" }] })];
    const w = computeClusterWaste(nodes, pods);
    expect(w.nodes[0]!.requestedCpuMillis).toBe(0);
  });

  it("sums total idle across all nodes", () => {
    const nodes = [node("node-1", "4", "16Gi"), node("node-2", "2", "8Gi")];
    const pods: ReturnType<typeof pod>[] = [];
    const w = computeClusterWaste(nodes, pods);
    expect(w.totalIdleCpuMillis).toBe(6000);
    expect(w.totalIdleMemBytes).toBe(24 * 1024 ** 3);
  });
});
