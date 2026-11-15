import { describe, it, expect } from "vitest";
import { computeGpuCapacity, isGpuResource } from "../gpuCapacity";

type Obj = Record<string, unknown>;

const node = (name: string, allocatable: Record<string, string>): Obj => ({ metadata: { name }, status: { allocatable } });
const pod = (name: string, nodeName: string, limits: Record<string, string>, phase = "Running", ns = "ml", requests?: Record<string, string>): Obj => ({
  metadata: { name, namespace: ns },
  spec: { nodeName, containers: [{ name: "c", resources: { limits, ...(requests ? { requests } : {}) } }] },
  status: { phase },
});

describe("isGpuResource", () => {
  it("recognises vendor GPU and MIG resources, not CPU or memory", () => {
    expect(isGpuResource("nvidia.com/gpu")).toBe(true);
    expect(isGpuResource("amd.com/gpu")).toBe(true);
    expect(isGpuResource("gpu.intel.com/i915")).toBe(true);
    expect(isGpuResource("nvidia.com/mig-1g.5gb")).toBe(true);
    expect(isGpuResource("cpu")).toBe(false);
    expect(isGpuResource("hugepages-2Mi")).toBe(false);
  });
});

describe("computeGpuCapacity", () => {
  it("reports nothing for a cluster without GPU nodes", () => {
    const r = computeGpuCapacity([node("n1", { cpu: "4", memory: "16Gi" })], []);
    expect(r.nodes).toEqual([]);
    expect(r.totals).toEqual([]);
  });

  it("counts allocatable vs requested GPUs per node and resource", () => {
    const r = computeGpuCapacity(
      [node("g1", { "nvidia.com/gpu": "4" }), node("g2", { "nvidia.com/gpu": "8" })],
      [pod("train", "g1", { "nvidia.com/gpu": "2" }), pod("infer", "g1", { "nvidia.com/gpu": "1" })],
    );
    expect(r.nodes).toEqual([
      { node: "g1", resource: "nvidia.com/gpu", allocatable: 4, requested: 3 },
      { node: "g2", resource: "nvidia.com/gpu", allocatable: 8, requested: 0 },
    ]);
    expect(r.totals).toEqual([{ resource: "nvidia.com/gpu", allocatable: 12, requested: 3, idle: 9 }]);
  });

  it("uses requests when set and falls back to limits, and ignores finished pods", () => {
    const r = computeGpuCapacity(
      [node("g1", { "nvidia.com/gpu": "4" })],
      [
        pod("a", "g1", { "nvidia.com/gpu": "2" }, "Running", "ml", { "nvidia.com/gpu": "2" }),
        pod("done", "g1", { "nvidia.com/gpu": "2" }, "Succeeded"),
        pod("failed", "g1", { "nvidia.com/gpu": "1" }, "Failed"),
      ],
    );
    expect(r.totals[0]).toMatchObject({ requested: 2, idle: 2 });
  });

  it("lists GPU pods, and pending ones waiting for a GPU separately", () => {
    const r = computeGpuCapacity(
      [node("g1", { "nvidia.com/gpu": "1" })],
      [pod("train", "g1", { "nvidia.com/gpu": "1" }), pod("queued", "", { "nvidia.com/gpu": "2" }, "Pending")],
    );
    expect(r.pods).toEqual([{ namespace: "ml", pod: "train", node: "g1", resource: "nvidia.com/gpu", count: 1 }]);
    expect(r.pending).toEqual([{ namespace: "ml", pod: "queued", node: "", resource: "nvidia.com/gpu", count: 2 }]);
  });

  it("keeps MIG slices as their own resource", () => {
    const r = computeGpuCapacity([node("a100", { "nvidia.com/mig-1g.5gb": "7" })], [pod("p", "a100", { "nvidia.com/mig-1g.5gb": "3" })]);
    expect(r.totals).toEqual([{ resource: "nvidia.com/mig-1g.5gb", allocatable: 7, requested: 3, idle: 4 }]);
  });

  it("counts init containers the way the scheduler does: max(largest init, sum of containers)", () => {
    const withInit: Obj = {
      metadata: { name: "p", namespace: "ml" },
      spec: {
        nodeName: "g1",
        initContainers: [{ name: "warm", resources: { limits: { "nvidia.com/gpu": "1" } } }],
        containers: [{ name: "c", resources: { limits: { "nvidia.com/gpu": "2" } } }],
      },
      status: { phase: "Running" },
    };
    const r = computeGpuCapacity([node("g1", { "nvidia.com/gpu": "4" })], [withInit]);
    expect(r.totals[0]?.requested).toBe(2);
  });
});
