import { describe, it, expect } from "vitest";
import { summarizeShowback } from "../fleetShowback";
import type { WorkloadWaste } from "../api";

const Mi = 1024 ** 2;
const wl = (o: Partial<WorkloadWaste>): WorkloadWaste => ({
  cluster: "c1", ns: "shop", kind: "Deployment", name: "w", podCount: 1,
  requestedCpuMillis: 100, requestedMemBytes: 128 * Mi, p95CpuMillis: 90, p95MemBytes: 120 * Mi,
  source: "metrics-server", window: "live", ...o,
});

describe("summarizeShowback", () => {
  it("groups the same namespace name across clusters into one row", () => {
    const rows = summarizeShowback([
      { cluster: "prod", waste: [wl({ ns: "payments", name: "api", requestedCpuMillis: 1000, p95CpuMillis: 400 })] },
      { cluster: "staging", waste: [wl({ ns: "payments", name: "api", requestedCpuMillis: 500, p95CpuMillis: 100 })] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ns: "payments", clusters: ["prod", "staging"], workloads: 2, requestedCpuMillis: 1500, p95CpuMillis: 500 });
  });

  it("counts waste only for workloads past the right-sizing materiality gate, like the fleet total", () => {
    const rows = summarizeShowback([
      {
        cluster: "c1",
        waste: [
          wl({ name: "fat", requestedCpuMillis: 2000, p95CpuMillis: 200 }),
          wl({ name: "tight", requestedCpuMillis: 100, p95CpuMillis: 95 }),
        ],
      },
    ]);
    expect(rows[0]?.wastedCpuMillis).toBe(1800);
  });

  it("sorts by requested CPU, largest first", () => {
    const rows = summarizeShowback([
      { cluster: "c1", waste: [wl({ ns: "small", requestedCpuMillis: 100 }), wl({ ns: "big", requestedCpuMillis: 4000 })] },
    ]);
    expect(rows.map((r) => r.ns)).toEqual(["big", "small"]);
  });

  it("returns nothing when no cluster has usage data", () => {
    expect(summarizeShowback([{ cluster: "c1", waste: [] }])).toEqual([]);
  });
});
