import { describe, it, expect } from "vitest";
import { buildWarningHeatStrip } from "../eventHeatStrip";

const NOW = 1_000_000_000_000; // fixed epoch ms for deterministic tests
const HOUR = 60 * 60 * 1000;

describe("buildWarningHeatStrip", () => {
  it("returns 30 empty buckets spanning the last hour for no events", () => {
    const buckets = buildWarningHeatStrip([], { now: NOW });
    expect(buckets).toHaveLength(30);
    expect(buckets.every((b) => b.value === 0)).toBe(true);
    expect(buckets[0]!.start).toBe(NOW - HOUR);
    expect(buckets[29]!.end).toBe(NOW);
  });

  it("places a single-occurrence event in the bucket containing its timestamp", () => {
    const buckets = buildWarningHeatStrip([{ ts: NOW - 1000, count: 1 }], { now: NOW });
    const nonZero = buckets.filter((b) => b.value > 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0]!.value).toBe(1);
    expect(nonZero[0]!.start).toBeLessThanOrEqual(NOW - 1000);
    expect(nonZero[0]!.end).toBeGreaterThan(NOW - 1000);
  });

  it("ignores an event entirely outside the window", () => {
    const buckets = buildWarningHeatStrip([{ ts: NOW - 2 * HOUR, count: 5 }], { now: NOW });
    expect(buckets.every((b) => b.value === 0)).toBe(true);
  });

  it("spreads a flapping event's count across its first..last span, summing to the count", () => {
    const events = [{ ts: NOW - 5 * 60 * 1000, firstTs: NOW - 55 * 60 * 1000, count: 10 }];
    const buckets = buildWarningHeatStrip(events, { now: NOW });
    const total = buckets.reduce((sum, b) => sum + b.value, 0);
    expect(total).toBeCloseTo(10, 5);
    // A 50-minute flap should not land entirely in one 2-minute bucket.
    const nonZero = buckets.filter((b) => b.value > 0);
    expect(nonZero.length).toBeGreaterThan(1);
  });

  it("clamps a span that starts before the visible window to the window edge", () => {
    const events = [{ ts: NOW - 5 * 60 * 1000, firstTs: NOW - 3 * HOUR, count: 4 }];
    const buckets = buildWarningHeatStrip(events, { now: NOW });
    const total = buckets.reduce((sum, b) => sum + b.value, 0);
    expect(total).toBeCloseTo(4, 5);
  });

  it("treats a missing count as 1 occurrence", () => {
    const buckets = buildWarningHeatStrip([{ ts: NOW - 1000, count: 0 }], { now: NOW });
    const total = buckets.reduce((sum, b) => sum + b.value, 0);
    expect(total).toBe(1);
  });

  it("caps the number of spread samples for a pathologically large count", () => {
    const events = [{ ts: NOW, firstTs: NOW - HOUR, count: 1_000_000 }];
    const start = performance.now();
    const buckets = buildWarningHeatStrip(events, { now: NOW });
    expect(performance.now() - start).toBeLessThan(200);
    const total = buckets.reduce((sum, b) => sum + b.value, 0);
    expect(total).toBeCloseTo(1_000_000, -2);
  });
});
