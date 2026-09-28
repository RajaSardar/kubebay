import { describe, it, expect } from "vitest";
import { summarizeFleetWaste } from "../fleetWaste";
import type { WorkloadWaste } from "../api";

function waste(overrides: Partial<WorkloadWaste> = {}): WorkloadWaste {
  return {
    cluster: "kind-a",
    ns: "default",
    kind: "Deployment",
    name: "web",
    podCount: 3,
    requestedCpuMillis: 1000,
    requestedMemBytes: 1024 ** 3,
    p95CpuMillis: 200,
    p95MemBytes: 256 * 1024 ** 2,
    source: "metrics-server",
    window: "3h",
    ...overrides,
  };
}

describe("summarizeFleetWaste", () => {
  it("sums material waste across clusters using the same gate the Right-sizing page uses", () => {
    const summary = summarizeFleetWaste([
      { cluster: "kind-a", waste: [waste()] },
      { cluster: "kind-b", waste: [waste({ cluster: "kind-b", requestedCpuMillis: 500, p95CpuMillis: 100 })] },
    ]);
    expect(summary.perCluster).toHaveLength(2);
    expect(summary.totalWastedCpuMillis).toBeGreaterThan(0);
    expect(summary.totalWastedCpuMillis).toBe(summary.perCluster[0]!.wastedCpuMillis + summary.perCluster[1]!.wastedCpuMillis);
  });

  it("excludes a workload whose waste isn't material, matching Right-sizing's own gate", () => {
    // Both dimensions differ by well under the 20%/50m-64Mi materiality gate.
    const summary = summarizeFleetWaste([
      { cluster: "kind-a", waste: [waste({ requestedCpuMillis: 100, p95CpuMillis: 95, requestedMemBytes: 100 * 1024 ** 2, p95MemBytes: 95 * 1024 ** 2 })] },
    ]);
    expect(summary.perCluster[0]!.opportunities).toBe(0);
    expect(summary.totalWastedCpuMillis).toBe(0);
  });

  it("returns a zeroed summary for an empty fleet", () => {
    expect(summarizeFleetWaste([])).toEqual({ totalWastedCpuMillis: 0, totalWastedMemBytes: 0, perCluster: [] });
  });
});
