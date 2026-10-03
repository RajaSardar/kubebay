import { describe, it, expect } from "vitest";
import { computeEfficiencyScore } from "../efficiencyScore";
import type { ClusterWaste, NodeWaste } from "../waste";
import type { WorkloadWaste } from "../api";

const GiB = 1024 ** 3;

function node(o: Partial<NodeWaste> = {}): NodeWaste {
  return {
    name: "n1",
    allocatableCpuMillis: 4000,
    allocatableMemBytes: 16 * GiB,
    requestedCpuMillis: 0,
    requestedMemBytes: 0,
    idleCpuMillis: 0,
    idleMemBytes: 0,
    systemOverheadCpuMillis: 0,
    systemOverheadMemBytes: 0,
    byNamespace: [],
    ...o,
  };
}

function waste(nodes: NodeWaste[], unrequested = 0): ClusterWaste {
  return {
    nodes,
    totalIdleCpuMillis: 0,
    totalIdleMemBytes: 0,
    totalSystemOverheadCpuMillis: 0,
    totalSystemOverheadMemBytes: 0,
    byNamespace: [],
    unrequestedContainers: Array.from({ length: unrequested }, (_, i) => ({ ns: "a", pod: `p${i}`, container: "c", node: "n1" })),
  };
}

function pod(containers: number, nodeName = "n1") {
  return { metadata: { name: "p", namespace: "a" }, spec: { nodeName, containers: Array.from({ length: containers }, (_, i) => ({ name: `c${i}` })) } };
}

function wl(o: Partial<WorkloadWaste>): WorkloadWaste {
  return {
    cluster: "c1", ns: "a", kind: "Deployment", name: "w", podCount: 1,
    requestedCpuMillis: 100, requestedMemBytes: 128 * 1024 ** 2, p95CpuMillis: 90, p95MemBytes: 120 * 1024 ** 2,
    source: "metrics-server", window: "live", ...o,
  };
}

describe("computeEfficiencyScore", () => {
  it("returns no score for a cluster with no allocatable capacity", () => {
    const s = computeEfficiencyScore(waste([]), [], undefined);
    expect(s.score).toBeNull();
    expect(s.grade).toBeNull();
  });

  it("gives full provisioning marks at 80% requested and scales linearly below", () => {
    const full = computeEfficiencyScore(waste([node({ requestedCpuMillis: 3200, requestedMemBytes: 12.8 * GiB })]), [pod(1)], undefined);
    expect(full.components.find((c) => c.key === "provisioning")?.score).toBe(100);
    const half = computeEfficiencyScore(waste([node({ requestedCpuMillis: 1600, requestedMemBytes: 6.4 * GiB })]), [pod(1)], undefined);
    expect(half.components.find((c) => c.key === "provisioning")?.score).toBe(50);
  });

  it("averages CPU and memory provisioning", () => {
    // CPU 80% -> 100, memory 40% -> 50
    const s = computeEfficiencyScore(waste([node({ requestedCpuMillis: 3200, requestedMemBytes: 6.4 * GiB })]), [pod(1)], undefined);
    expect(s.components.find((c) => c.key === "provisioning")?.score).toBe(75);
  });

  it("scores request coverage as the share of scheduled containers that set requests", () => {
    const s = computeEfficiencyScore(waste([node()], 1), [pod(3), pod(1), pod(5, "")], undefined);
    expect(s.components.find((c) => c.key === "coverage")?.score).toBe(75);
  });

  it("leaves out workload optimization when no usage data is available and renormalizes the weights", () => {
    const s = computeEfficiencyScore(waste([node({ requestedCpuMillis: 3200, requestedMemBytes: 12.8 * GiB })], 1), [pod(2)], undefined);
    expect(s.components.map((c) => c.key)).toEqual(["provisioning", "coverage"]);
    expect(s.missing).toEqual(["optimization"]);
    // provisioning 100 (weight 0.5), coverage 50 (weight 0.2) -> (50 + 10) / 0.7
    expect(s.score).toBe(86);
  });

  it("scores workload optimization as the share of measured workloads with no material waste", () => {
    const workloads = [
      wl({ name: "ok" }),
      wl({ name: "fat", requestedCpuMillis: 2000, p95CpuMillis: 100 }),
      wl({ name: "ok2" }),
      wl({ name: "ok3" }),
    ];
    const s = computeEfficiencyScore(waste([node({ requestedCpuMillis: 3200, requestedMemBytes: 12.8 * GiB })]), [pod(1)], workloads);
    expect(s.components.find((c) => c.key === "optimization")?.score).toBe(75);
    // 0.5*100 + 0.2*100 + 0.3*75 = 92.5
    expect(s.score).toBe(93);
    expect(s.missing).toEqual([]);
  });

  it("ignores workload kinds the right-sizing view does not support", () => {
    const s = computeEfficiencyScore(waste([node()]), [pod(1)], [wl({ kind: "Job", requestedCpuMillis: 2000, p95CpuMillis: 1 }), wl({})]);
    expect(s.components.find((c) => c.key === "optimization")?.score).toBe(100);
  });

  it("grades good at 75+, fair at 50+, poor below", () => {
    const at = (cpu: number) =>
      computeEfficiencyScore(waste([node({ requestedCpuMillis: cpu, requestedMemBytes: (cpu / 4000) * 16 * GiB })]), [pod(1)], undefined).grade;
    expect(at(3200)).toBe("good");
    expect(at(1600)).toBe("fair"); // provisioning 50, coverage 100 -> 64
    expect(at(0)).toBe("poor"); // coverage 100 only -> 29
  });
});
