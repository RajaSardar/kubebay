import { describe, it, expect } from "vitest";
import { GPU_UTIL_QUERIES, summarizeGpuUtilisation, type GpuQueryResults } from "../gpuUtilisation";
import type { GpuPod } from "../gpuCapacity";

type Series = { metric: Record<string, string>; value: [number, string] };

const gpuPod = (pod: string, ns = "ml", count = 1, resource = "nvidia.com/gpu"): GpuPod => ({ namespace: ns, pod, node: "gpu-1", resource, count });

// The DCGM exporter's own labels: pod/namespace (or pod_name/pod_namespace with --use-old-namespace).
// Scraped with honorLabels: false (both NVIDIA charts' default), Prometheus renames them exported_*.
const s = (labels: Record<string, string>, v: number): Series => ({ metric: { UUID: "GPU-1", gpu: "0", Hostname: "gpu-1", ...labels }, value: [0, String(v)] });

function results(per: Partial<Record<keyof typeof GPU_UTIL_QUERIES, Series[]>>): GpuQueryResults {
  const out = {} as GpuQueryResults;
  for (const k of Object.keys(GPU_UTIL_QUERIES) as (keyof typeof GPU_UTIL_QUERIES)[]) out[k] = per[k] ?? [];
  return out;
}

const workload = { exported_namespace: "ml", exported_pod: "trainer-0", namespace: "gpu-operator", pod: "dcgm-exporter-abc" };

describe("summarizeGpuUtilisation", () => {
  it("attributes series by exported_pod when Prometheus renamed the exporter's labels", () => {
    const r = summarizeGpuUtilisation(
      [gpuPod("trainer-0")],
      results({
        utilAvg: [s(workload, 4)],
        utilMax: [s(workload, 22)],
        samples: [s(workload, 288)],
        fbUsedMax: [s(workload, 2048)],
        fbTotal: [s(workload, 40960)],
      }),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ namespace: "ml", pod: "trainer-0", gpus: 1, avgUtil: 4, peakUtil: 22, hoursObserved: 24, fbPeakMiB: 2048, fbTotalMiB: 40960, verdict: "underused" });
  });

  it("reads pod/namespace when labels were honoured, and pod_name/pod_namespace in the exporter's old naming", () => {
    const pods = [gpuPod("a"), gpuPod("b")];
    const r = summarizeGpuUtilisation(
      pods,
      results({
        utilAvg: [s({ namespace: "ml", pod: "a" }, 80), s({ pod_namespace: "ml", pod_name: "b", namespace: "gpu-operator", pod: "dcgm-x", UUID: "GPU-2" }, 70)],
        utilMax: [s({ namespace: "ml", pod: "a" }, 99), s({ pod_namespace: "ml", pod_name: "b", namespace: "gpu-operator", pod: "dcgm-x", UUID: "GPU-2" }, 95)],
        samples: [s({ namespace: "ml", pod: "a" }, 288), s({ pod_namespace: "ml", pod_name: "b", namespace: "gpu-operator", pod: "dcgm-x", UUID: "GPU-2" }, 288)],
      }),
    );
    expect(r.rows.map((x) => [x.pod, x.verdict])).toEqual([
      ["a", "busy"],
      ["b", "busy"],
    ]);
  });

  it("never credits a GPU to the exporter's own pod: only pods that claim a GPU are matched", () => {
    // No GPU is allocated, so the series carry only the scrape's own pod label.
    const r = summarizeGpuUtilisation([gpuPod("trainer-0")], results({ utilAvg: [s({ namespace: "gpu-operator", pod: "dcgm-exporter-abc" }, 0)] }));
    expect(r.rows[0]).toMatchObject({ pod: "trainer-0", verdict: "no-data" });
    expect(r.dcgmFound).toBe(true);
  });

  it("averages a multi-GPU pod across its GPUs and takes the highest peak", () => {
    const g1 = { ...workload, UUID: "GPU-1" };
    const g2 = { ...workload, UUID: "GPU-2" };
    const r = summarizeGpuUtilisation(
      [gpuPod("trainer-0", "ml", 2)],
      results({ utilAvg: [s(g1, 10), s(g2, 30)], utilMax: [s(g1, 50), s(g2, 90)], samples: [s(g1, 288), s(g2, 144)] }),
    );
    expect(r.rows[0]).toMatchObject({ gpus: 2, avgUtil: 20, peakUtil: 90, hoursObserved: 12, verdict: "busy" });
  });

  it("uses graphics-engine activity for MIG slices, where GPU_UTIL isn't reported", () => {
    const mig = { ...workload, GPU_I_ID: "3", GPU_I_PROFILE: "1g.5gb" };
    const r = summarizeGpuUtilisation(
      [gpuPod("trainer-0", "ml", 1, "nvidia.com/mig-1g.5gb")],
      results({ engineAvg: [s(mig, 0.05)], engineMax: [s(mig, 0.2)], engineSamples: [s(mig, 288)] }),
    );
    expect(r.rows[0]).toMatchObject({ avgUtil: 5, peakUtil: 20, source: "engine-active", verdict: "underused" });
  });

  it("won't call a GPU underused on under six hours of data", () => {
    const r = summarizeGpuUtilisation([gpuPod("trainer-0")], results({ utilAvg: [s(workload, 1)], utilMax: [s(workload, 2)], samples: [s(workload, 60)] }));
    expect(r.rows[0]).toMatchObject({ hoursObserved: 5, verdict: "too-little-data" });
  });

  it("skips GPU resources DCGM can't see (AMD, Intel) and reports when no DCGM metric exists at all", () => {
    const r = summarizeGpuUtilisation([gpuPod("a", "ml", 1, "amd.com/gpu")], results({}));
    expect(r.rows).toEqual([]);
    expect(r.dcgmFound).toBe(false);
  });

  it("ranks underused pods first, then by average utilisation", () => {
    const pods = [gpuPod("busy"), gpuPod("idle")];
    const busy = { namespace: "ml", pod: "busy", UUID: "GPU-1" };
    const idle = { namespace: "ml", pod: "idle", UUID: "GPU-2" };
    const r = summarizeGpuUtilisation(
      pods,
      results({ utilAvg: [s(busy, 70), s(idle, 2)], utilMax: [s(busy, 99), s(idle, 5)], samples: [s(busy, 288), s(idle, 288)] }),
    );
    expect(r.rows.map((x) => x.pod)).toEqual(["idle", "busy"]);
  });
});
