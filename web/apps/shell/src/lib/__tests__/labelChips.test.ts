import { describe, expect, it } from "vitest";
import { labelChips, labelPairs } from "../labelChips";

// Backlog 65: the Labels column on Pods and the other resource lists.
describe("labelPairs", () => {
  it("lists key=value pairs sorted by key", () => {
    expect(labelPairs({ tier: "web", app: "shop" })).toEqual(["app=shop", "tier=web"]);
  });
  it("is empty for none", () => {
    expect(labelPairs(undefined)).toEqual([]);
    expect(labelPairs({})).toEqual([]);
  });
});

describe("labelChips", () => {
  it("shows the first few and counts the rest", () => {
    const labels = { a: "1", b: "2", c: "3", d: "4", e: "5" };
    expect(labelChips(labels, 3)).toEqual({ shown: ["a=1", "b=2", "c=3"], more: 2 });
  });
  it("shows all when they fit", () => {
    expect(labelChips({ a: "1" }, 3)).toEqual({ shown: ["a=1"], more: 0 });
  });
});
