import { describe, it, expect } from "vitest";
import { clampReplicas, sliderMax, positionFromReplica, replicaFromPosition, presetChips, POSITION_MAX } from "../replicaScale";

describe("clampReplicas", () => {
  it("floors, and holds at 0 for negatives and junk", () => {
    expect(clampReplicas(3.9)).toBe(3);
    expect(clampReplicas(-4)).toBe(0);
    expect(clampReplicas(Number.NaN)).toBe(0);
    expect(clampReplicas(Infinity)).toBe(0);
  });
});

describe("sliderMax", () => {
  it("is at least 10 and rounds 3x the live count up to a nice number", () => {
    expect(sliderMax(0)).toBe(10);
    expect(sliderMax(1)).toBe(10);
    expect(sliderMax(3)).toBe(10);
    expect(sliderMax(4)).toBe(20); // 12 -> 20
    expect(sliderMax(10)).toBe(30);
    expect(sliderMax(18)).toBe(100); // 54 -> 100
    expect(sliderMax(100)).toBe(300);
    expect(sliderMax(3000)).toBe(10000);
  });
  it("treats an unknown count as 0", () => {
    expect(sliderMax(undefined)).toBe(10);
  });
});

describe("slider mapping", () => {
  const maxes = [10, 20, 30, 50, 100, 200, 1000, 10000];
  it("maps the ends of the track to 0 and the max", () => {
    for (const max of maxes) {
      expect(replicaFromPosition(0, max)).toBe(0);
      expect(replicaFromPosition(POSITION_MAX, max)).toBe(max);
    }
  });
  it("gives 0..10 one by one on the first band", () => {
    for (let n = 0; n <= 10; n++) expect(replicaFromPosition(positionFromReplica(n, 100), 100)).toBe(n);
  });
  it("is monotonic over every position", () => {
    for (const max of maxes) {
      let prev = -1;
      for (let p = 0; p <= POSITION_MAX; p++) {
        const r = replicaFromPosition(p, max);
        expect(r).toBeGreaterThanOrEqual(prev);
        expect(r).toBeLessThanOrEqual(max);
        prev = r;
      }
    }
  });
  it("round-trips every replica 0..max exactly where the track has room, and to the nearest step elsewhere", () => {
    for (const max of maxes) {
      for (let n = 0; n <= max; n++) {
        const back = replicaFromPosition(positionFromReplica(n, max), max);
        if (max <= 100) expect(back).toBe(n);
        else expect(Math.abs(back - n)).toBeLessThanOrEqual(Math.ceil((max - 10) / 600) * 1.5);
      }
    }
  });
  it("is idempotent: a value the track yields maps back to the same position's value", () => {
    for (const max of [10, 100, 10000]) {
      for (let p = 0; p <= POSITION_MAX; p++) {
        const r = replicaFromPosition(p, max);
        expect(replicaFromPosition(positionFromReplica(r, max), max)).toBe(r);
      }
    }
  });
  it("pins a value above the max to the right end", () => {
    expect(positionFromReplica(500, 100)).toBe(POSITION_MAX);
  });
});

describe("presetChips", () => {
  const values = (c: number) => presetChips(c).map((x) => x.value);
  it("is sorted ascending with no duplicates and always has Current", () => {
    for (const c of [0, 1, 2, 3, 4, 5, 6, 10, 18, 100, 5000]) {
      const v = values(c);
      expect(new Set(v).size).toBe(v.length);
      expect([...v].sort((a, b) => a - b)).toEqual(v);
      expect(v).toContain(c);
      expect(v.length).toBeLessThanOrEqual(8);
    }
  });
  it("labels the special chips", () => {
    const chips = presetChips(18);
    expect(chips.find((x) => x.value === 0)?.label).toBe("0 (stop)");
    expect(chips.find((x) => x.value === 18)?.label).toBe("Current (18)");
    expect(chips.find((x) => x.value === 9)?.label).toBe("Half (9)");
    expect(chips.find((x) => x.value === 36)?.label).toBe("2× (36)");
  });
  it("does not repeat a number when Half or 2x land on a fixed preset", () => {
    expect(values(10)).toEqual([0, 1, 2, 3, 5, 10, 20]);
    expect(presetChips(10).find((x) => x.value === 5)?.label).toBe("Half (5)");
  });
  it("handles a current of 0 and 1", () => {
    expect(values(0)).toEqual([0, 1, 2, 3, 5, 10]);
    expect(presetChips(0).find((x) => x.value === 0)?.label).toBe("Current (0)");
    expect(values(1)).toEqual([0, 1, 2, 3, 5, 10]);
  });
  it("caps at 8, keeping 0 and Current", () => {
    const v = values(4);
    expect(v.length).toBeLessThanOrEqual(8);
    expect(v).toContain(0);
    expect(v).toContain(4);
  });
});
