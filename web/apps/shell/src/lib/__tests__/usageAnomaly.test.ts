import { describe, it, expect } from "vitest";
import { findUsageAnomalies, ANOMALY_MIN_BASELINE_DAYS } from "../usageAnomaly";
import type { HistoryPoint } from "../headroomForecast";

// 2026-09-07 is a Monday. Local-time hours keep this TZ-independent.
function at(day: number, h: number, vals: Partial<HistoryPoint> = {}, well = true): HistoryPoint {
  return {
    t: new Date(2026, 8, day, h).toISOString(),
    n: well ? 60 : 10,
    wellSampled: well,
    cpuMean: null, cpuMax: null, memMean: null, memMax: null, reqCpuMillis: null, reqMemBytes: null,
    ...vals,
  };
}

// Weekdays Mon 7 .. Fri 11 and Mon 14 .. Fri 18 at 10:00 with steady CPU ~1000m.
const weekdays = [7, 8, 9, 10, 11, 14, 15, 16, 17];
const baseline = weekdays.map((d, i) => at(d, 10, { cpuMean: 1000 + (i % 3) * 20 }));
const now = new Date(2026, 8, 18, 12);

describe("findUsageAnomalies", () => {
  it("flags an hour far above the same hour on prior weekdays", () => {
    const pts = [...baseline, at(18, 10, { cpuMean: 3100 })];
    const a = findUsageAnomalies(pts, { now });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ metric: "cpuUsage", value: 3100, usual: 1020, baselineDays: 9, direction: "up" });
    expect(a[0]!.ratio).toBeCloseTo(3100 / 1020);
  });

  it("does not flag ordinary variation", () => {
    const pts = [...baseline, at(18, 10, { cpuMean: 1060 })];
    expect(findUsageAnomalies(pts, { now })).toEqual([]);
  });

  it("flags a drop as well as a spike", () => {
    const pts = [...baseline, at(18, 10, { cpuMean: 200 })];
    expect(findUsageAnomalies(pts, { now })[0]).toMatchObject({ direction: "down" });
  });

  it("needs at least five prior same-hour days of the same day type", () => {
    const four = [7, 8, 9, 10].map((d) => at(d, 10, { cpuMean: 1000 }));
    expect(ANOMALY_MIN_BASELINE_DAYS).toBe(5);
    expect(findUsageAnomalies([...four, at(11, 10, { cpuMean: 5000 })], { now: new Date(2026, 8, 11, 12) })).toEqual([]);
  });

  it("never compares a weekend hour with weekday hours", () => {
    // Saturday 19th at 10:00 vs a weekday-only baseline: no weekend baseline, so nothing to flag.
    const pts = [...baseline, at(19, 10, { cpuMean: 100 })];
    expect(findUsageAnomalies(pts, { now: new Date(2026, 8, 19, 12) })).toEqual([]);
  });

  it("ignores thin hours, both as candidates and as baseline", () => {
    const pts = [...baseline, at(18, 10, { cpuMean: 3100 }, false)];
    expect(findUsageAnomalies(pts, { now })).toEqual([]);
  });

  it("only reports hours inside the recent window", () => {
    const pts = [...baseline, at(17, 10, { cpuMean: 3100 })];
    // 17th 10:00 is 50h before now; the default window is the last 24h.
    expect(findUsageAnomalies(pts.filter((p) => p !== baseline[8]), { now })).toEqual([]);
    expect(findUsageAnomalies(pts.filter((p) => p !== baseline[8]), { now, windowHours: 72 })).toHaveLength(1);
  });

  it("checks requests and memory too, and skips tiny absolute changes", () => {
    const pts = [
      ...weekdays.map((d) => at(d, 10, { reqCpuMillis: 2000, memMean: 4e9, cpuMean: 10 })),
      at(18, 10, { reqCpuMillis: 6000, memMean: 4.1e9, cpuMean: 30 }),
    ];
    const a = findUsageAnomalies(pts, { now });
    // CPU 10m → 30m is 3× but only 20m: below the absolute floor.
    expect(a.map((x) => x.metric)).toEqual(["cpuRequests"]);
  });
});
