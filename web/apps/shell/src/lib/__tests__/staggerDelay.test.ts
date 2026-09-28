import { describe, it, expect } from "vitest";
import { staggerDelay } from "../staggerDelay";

describe("staggerDelay", () => {
  it("gives the first wave of clusters (up to concurrency) no delay", () => {
    expect(staggerDelay(0, 3, 500)).toBe(0);
    expect(staggerDelay(1, 3, 500)).toBe(0);
    expect(staggerDelay(2, 3, 500)).toBe(0);
  });

  it("delays the next wave by one interval, so a Fleet page with many connected clusters doesn't open every full-mode subscription in the same tick", () => {
    expect(staggerDelay(3, 3, 500)).toBe(500);
    expect(staggerDelay(5, 3, 500)).toBe(500);
    expect(staggerDelay(6, 3, 500)).toBe(1000);
  });

  it("never returns a negative delay for index 0 regardless of concurrency", () => {
    expect(staggerDelay(0, 1, 1000)).toBe(0);
  });
});
