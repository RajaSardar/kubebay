import { describe, it, expect } from "vitest";
import { forecastHeadroom, FORECAST_MIN_DAYS, type HistoryPoint } from "../headroomForecast";

// Local-time hours so day grouping matches the viewer's calendar in any TZ.
function hour(day: number, h: number, vals: Partial<HistoryPoint> = {}): HistoryPoint {
  return {
    t: new Date(2026, 8, day, h).toISOString(),
    n: 60,
    wellSampled: true,
    cpuMean: null,
    cpuMax: null,
    memMean: null,
    memMax: null,
    reqCpuMillis: null,
    reqMemBytes: null,
    ...vals,
  };
}

/** `hours` well-sampled hours (09:00 onward) on each of `days`, with the value from f(dayIndex, hourIndex). */
function days(dayNums: number[], hours: number, f: (d: number, h: number) => Partial<HistoryPoint>): HistoryPoint[] {
  return dayNums.flatMap((d, di) => Array.from({ length: hours }, (_, hi) => hour(d, 9 + hi, f(di, hi))));
}

const cap = { cpuMillis: 4000, memBytes: 8e9 };
const byMetric = (r: ReturnType<typeof forecastHeadroom>, m: string) => r.metrics.find((x) => x.metric === m)!;

describe("forecastHeadroom", () => {
  it("is not ready with only four qualifying days, and says how many more are needed", () => {
    const pts = days([1, 2, 3, 4], 6, (d) => ({ reqCpuMillis: 1000 + d * 100 }));
    const f = byMetric(forecastHeadroom(pts, cap), "cpuRequests");
    expect(f.outcome).toBe("not-enough-data");
    expect(f.days).toBe(4);
    expect(f.daysNeeded).toBe(FORECAST_MIN_DAYS - 4);
  });

  it("does not count a day with only three well-sampled hours", () => {
    const pts = [
      ...days([1, 2, 3, 4], 4, (d) => ({ reqCpuMillis: 1000 + d * 100 })),
      ...days([5], 3, () => ({ reqCpuMillis: 2000 })),
    ];
    expect(byMetric(forecastHeadroom(pts, cap), "cpuRequests").outcome).toBe("not-enough-data");
  });

  it("ignores hours that are not well-sampled, both for the gate and the peak", () => {
    const pts = [
      ...days([1, 2, 3, 4, 5], 4, (d) => ({ reqCpuMillis: 1000 + d * 100 })),
      hour(5, 20, { wellSampled: false, n: 10, reqCpuMillis: 3900 }),
    ];
    const f = byMetric(forecastHeadroom(pts, cap), "cpuRequests");
    expect(f.peaks.map((p) => p.value)).toEqual([1000, 1100, 1200, 1300, 1400]);
  });

  it("fits the daily peak and projects when a rising trend reaches capacity", () => {
    // Peak rises 100m/day from 1000m; the last day (index 4) is 1400m. 4000m is reached in 26 more days.
    const pts = days([1, 2, 3, 4, 5], 5, (d, h) => ({ reqCpuMillis: 1000 + d * 100 - (h === 2 ? 0 : 200) }));
    const f = byMetric(forecastHeadroom(pts, cap, { horizonDays: 60 }), "cpuRequests");
    expect(f.outcome).toBe("reaches");
    expect(f.peaks.map((p) => p.value)).toEqual([1000, 1100, 1200, 1300, 1400]);
    expect(f.slopePerDay).toBeCloseTo(100);
    expect(f.latest).toBeCloseTo(1400);
    expect(f.daysToCapacity).toBeCloseTo(26);
  });

  it("calls a flat or falling trend flat, never a crossing", () => {
    const pts = days([1, 2, 3, 4, 5], 4, (d) => ({ reqMemBytes: 6e9 - d * 1e8 }));
    const f = byMetric(forecastHeadroom(pts, cap), "memRequests");
    expect(f.outcome).toBe("flat-or-falling");
    expect(f.daysToCapacity).toBeNull();
  });

  it("does not extrapolate past the horizon (twice the observed span by default)", () => {
    // 5-day span → 10-day horizon; +10m/day from 1000m needs ~296 days.
    const pts = days([1, 2, 3, 4, 5], 4, (d) => ({ reqCpuMillis: 1000 + d * 10 }));
    const f = byMetric(forecastHeadroom(pts, cap), "cpuRequests");
    expect(f.outcome).toBe("beyond-horizon");
    expect(f.horizonDays).toBe(10);
    expect(f.daysToCapacity).toBeNull();
  });

  it("reports at-capacity when the latest daily peak already meets capacity", () => {
    const pts = days([1, 2, 3, 4, 5], 4, (d) => ({ cpuMax: 3600 + d * 100 }));
    expect(byMetric(forecastHeadroom(pts, cap), "cpuUsage").outcome).toBe("at-capacity");
  });

  it("uses calendar days for the trend, so a skipped day doesn't compress the slope", () => {
    // Days 1,2,3,4 and 6: +100m per calendar day throughout.
    const pts = days([1, 2, 3, 4, 6], 4, (d) => ({ reqCpuMillis: 1000 + [0, 100, 200, 300, 500][d]! }));
    const f = byMetric(forecastHeadroom(pts, cap, { horizonDays: 60 }), "cpuRequests");
    expect(f.slopePerDay).toBeCloseTo(100);
  });

  it("gates usage separately: days without usage (no metrics-server) don't count for usage metrics", () => {
    const pts = days([1, 2, 3, 4, 5], 4, (d) => ({ reqCpuMillis: 1000, cpuMax: d < 2 ? 500 : null }));
    const r = forecastHeadroom(pts, cap);
    expect(byMetric(r, "cpuRequests").outcome).toBe("flat-or-falling");
    expect(byMetric(r, "cpuUsage").outcome).toBe("not-enough-data");
    expect(byMetric(r, "cpuUsage").days).toBe(2);
  });

  it("skips a resource whose capacity is unknown", () => {
    const pts = days([1, 2, 3, 4, 5], 4, () => ({ reqCpuMillis: 1000 }));
    const r = forecastHeadroom(pts, { cpuMillis: 4000, memBytes: 0 });
    expect(r.metrics.map((m) => m.metric)).toEqual(["cpuRequests", "cpuUsage"]);
  });
});
