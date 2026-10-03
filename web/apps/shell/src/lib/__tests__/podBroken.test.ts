import { describe, expect, it } from "vitest";
import fixtures from "../__fixtures__/podBroken.json";
import { podBroken } from "../attention";

// The engine records which workloads were broken each hour (the drawer's
// 7-day chip). Its Go podBroken must agree with the Overview's own rule, so
// both run these same fixtures.

describe("podBroken (shared fixtures with the engine)", () => {
  const now = Date.parse(fixtures.now);
  for (const c of fixtures.cases) {
    it(`${c.name}: ${c.broken ? "broken" : "fine"}`, () => {
      expect(podBroken(c.pod as Record<string, unknown>, now)).toBe(c.broken);
    });
  }
});
