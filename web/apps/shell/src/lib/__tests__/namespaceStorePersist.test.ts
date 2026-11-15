import { beforeEach, describe, expect, it, vi } from "vitest";

// ADR 0003 PR C: the namespaces picked for a cluster outlast a restart, so a
// namespace-limited identity doesn't name its namespaces again, and an admin
// comes back to the same view. "All namespaces" is nothing stored.

async function restart() {
  vi.resetModules();
  return (await import("../namespace-store")).useNamespaceStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("the namespace selection", () => {
  it("is restored after a restart, per cluster", async () => {
    const before = await restart();
    before.getState().setNamespaces("prod", ["shop", "payments"]);
    before.getState().setNamespaces("dev", ["data"]);
    const after = await restart();
    expect(after.getState().selections).toEqual({ prod: ["shop", "payments"], dev: ["data"] });
  });

  it("stores nothing for All namespaces", async () => {
    const before = await restart();
    before.getState().setNamespaces("prod", ["shop"]);
    before.getState().clearNamespaces("prod");
    const after = await restart();
    expect(after.getState().selections).toEqual({});
  });

  it("ignores a stored entry that isn't a list of names", async () => {
    localStorage.setItem(
      "kb.namespaces",
      JSON.stringify({ state: { selections: { a: "shop", b: ["ok", 3], c: ["data"], d: null } }, version: 1 }),
    );
    const after = await restart();
    expect(after.getState().selections).toEqual({ c: ["data"] });
  });

  it("starts empty from unreadable storage", async () => {
    localStorage.setItem("kb.namespaces", "{not json");
    const after = await restart();
    expect(after.getState().selections).toEqual({});
  });
});
