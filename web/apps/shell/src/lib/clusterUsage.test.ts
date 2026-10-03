import { describe, it, expect } from "vitest";
import { headroom, lastOpenedLabel, sparkline } from "./clusterUsage";
import type { ClusterHistorySummary, HistorySummaryPoint } from "./api";

const pt = (cpuMax: number | null, reqCpuMillis: number | null = null, memMax: number | null = null, reqMemBytes: number | null = null): HistorySummaryPoint => ({
  t: "2026-10-01T00:00:00Z",
  cpuMax,
  memMax,
  reqCpuMillis,
  reqMemBytes,
});

const sum = (points: HistorySummaryPoint[], allocCpuMillis = 0, allocMemBytes = 0, nodes = 0): ClusterHistorySummary => ({
  points,
  lastSample: "2026-10-01T00:00:00Z",
  allocCpuMillis,
  allocMemBytes,
  nodes,
});

describe("sparkline", () => {
  it("returns nothing when no bucket was recorded", () => {
    expect(sparkline(sum([pt(null), pt(null)]), 40, 10)).toBeNull();
  });

  it("breaks the line at unrecorded buckets instead of joining across the gap", () => {
    const s = sparkline(sum([pt(100), pt(200), pt(null), pt(400), pt(300)], 400), 40, 10)!;
    expect(s.path.match(/M/g)).toHaveLength(2);
  });

  it("scales to allocatable, so the height means utilisation", () => {
    const s = sparkline(sum([pt(1000), pt(2000)], 4000), 10, 20)!;
    // 2000 of 4000 is half height: y = 20 - 10.
    expect(s.path).toContain("10,10");
    expect(s.label).toBe("CPU peak over the last 7 days: 2 of 4 cores (50%)");
  });

  it("falls back to its own peak when capacity is unknown", () => {
    const s = sparkline(sum([pt(250), pt(500)]), 10, 20)!;
    expect(s.path).toContain("10,0");
    expect(s.label).toBe("CPU peak over the last 7 days: 0.5 cores");
  });

  it("draws a lone recorded bucket as a visible dot-length segment", () => {
    const s = sparkline(sum([pt(null), pt(500), pt(null)], 1000), 30, 10)!;
    expect(s.path).toMatch(/^M[\d.]+,[\d.]+ L/);
  });
});

describe("headroom", () => {
  it("uses the latest recorded requests against allocatable", () => {
    const h = headroom(sum([pt(1, 1000, null, 2 ** 30), pt(null), pt(1, 3000, null, 6 * 2 ** 30), pt(null)], 4000, 8 * 2 ** 30, 3))!;
    expect(h.cpuPct).toBe(75);
    expect(h.memPct).toBe(75);
    expect(h.tone).toBe("warn");
    expect(h.label).toBe("Requests use 75% of allocatable CPU and 75% of memory on 3 nodes");
  });

  it("is unknown without capacity", () => {
    expect(headroom(sum([pt(1, 1000)], 0))).toBeNull();
  });

  it("goes red near full and green with room", () => {
    expect(headroom(sum([pt(1, 3800, null, 0)], 4000, 1, 1))!.tone).toBe("err");
    expect(headroom(sum([pt(1, 400, null, 0)], 4000, 1, 1))!.tone).toBe("ok");
  });

  it("over-committed requests read above 100% and stay red", () => {
    const h = headroom(sum([pt(1, 5000, null, 0)], 4000, 1, 1))!;
    expect(h.cpuPct).toBe(125);
    expect(h.tone).toBe("err");
  });
});

describe("lastOpenedLabel", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  it("says when the cluster was last opened, coarsely", () => {
    expect(lastOpenedLabel(now - 30_000, now)).toBe("Opened just now");
    expect(lastOpenedLabel(now - 5 * 60_000, now)).toBe("Opened 5m ago");
    expect(lastOpenedLabel(now - 3 * 3600_000, now)).toBe("Opened 3h ago");
    expect(lastOpenedLabel(now - 4 * 86400_000, now)).toBe("Opened 4d ago");
    expect(lastOpenedLabel(undefined, now)).toBe("");
  });
});
