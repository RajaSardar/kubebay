import { describe, it, expect } from "vitest";
import { sortResourcesByDrift, driftCount } from "../argoDrift";
import type { ArgoCDResource } from "../api";

function res(overrides: Partial<ArgoCDResource> = {}): ArgoCDResource {
  return { group: "apps", kind: "Deployment", namespace: "default", name: "app", status: "Synced", health: "Healthy", ...overrides };
}

describe("sortResourcesByDrift", () => {
  it("sorts OutOfSync resources before Synced ones", () => {
    const synced = res({ name: "a" });
    const drifted = res({ name: "z", status: "OutOfSync" });
    expect(sortResourcesByDrift([synced, drifted]).map((r) => r.name)).toEqual(["z", "a"]);
  });

  it("sorts alphabetically by name within the same drift group", () => {
    const b = res({ name: "b", status: "OutOfSync" });
    const a = res({ name: "a", status: "OutOfSync" });
    expect(sortResourcesByDrift([b, a]).map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const input = [res({ name: "b" }), res({ name: "a" })];
    const copy = [...input];
    sortResourcesByDrift(input);
    expect(input).toEqual(copy);
  });
});

describe("driftCount", () => {
  it("counts only OutOfSync resources", () => {
    const resources = [res({ status: "OutOfSync" }), res({ status: "Synced" }), res({ status: "OutOfSync" })];
    expect(driftCount(resources)).toBe(2);
  });

  it("returns 0 for an empty or fully-synced list", () => {
    expect(driftCount([])).toBe(0);
    expect(driftCount([res(), res()])).toBe(0);
  });
});
