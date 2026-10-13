import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyView, captureView, exportViews, parseViewsFile, useSavedViews, type SavedView } from "../savedViews";
import { useNamespaceStore } from "../namespace-store";
import { useClusterStore } from "../cluster-store";

const base = { name: "Crashing shop pods", cluster: "kind-dev", kind: "deployments", namespaces: ["shop"], filter: "status:crash -name:canary" };

beforeEach(() => {
  localStorage.clear();
  useSavedViews.setState({ views: [] });
  useNamespaceStore.setState({ selections: {} });
  useClusterStore.setState({ active: "" });
});

describe("saved views (KB-16)", () => {
  it("captures the table's own sort and column layout", () => {
    localStorage.setItem("kb.sort.r/deployments", JSON.stringify({ col: "Ready", asc: false }));
    localStorage.setItem("kb.cols.r/deployments", JSON.stringify({ v: 1, order: ["Ready", "Age"], hidden: ["Owner"] }));
    const v = captureView(base);
    expect(v).toEqual({ ...base, sort: { col: "Ready", asc: false }, columns: { order: ["Ready", "Age"], hidden: ["Owner"] } });
    expect(captureView({ ...base, kind: "services" })).toEqual({ ...base, kind: "services" });
  });

  it("applies a view: cluster, namespaces, sort and columns, then the table with its filter", () => {
    const v = useSavedViews.getState().add({ ...base, sort: { col: "Ready", asc: false }, columns: { order: ["Ready"], hidden: ["Owner"] } });
    localStorage.setItem("kb.sort.r/deployments", JSON.stringify({ col: "Name", asc: true }));
    const to = applyView(v);
    expect(to).toBe(`/r/deployments?q=${encodeURIComponent(base.filter)}&view=${v.id}`);
    expect(useClusterStore.getState().active).toBe("kind-dev");
    expect(useNamespaceStore.getState().selections["kind-dev"]).toEqual(["shop"]);
    expect(JSON.parse(localStorage.getItem("kb.sort.r/deployments")!)).toEqual({ col: "Ready", asc: false });
    expect(JSON.parse(localStorage.getItem("kb.cols.r/deployments")!)).toEqual({ v: 1, order: ["Ready"], hidden: ["Owner"] });
  });

  it("applies all namespaces and the table's default layout when the view has none", () => {
    useNamespaceStore.setState({ selections: { "kind-dev": ["old"] } });
    localStorage.setItem("kb.cols.r/deployments", JSON.stringify({ v: 1, order: ["Age"], hidden: [] }));
    const v = useSavedViews.getState().add({ ...base, namespaces: [], filter: "" });
    expect(applyView(v)).toBe(`/r/deployments?view=${v.id}`);
    expect(useNamespaceStore.getState().selections["kind-dev"]).toBeUndefined();
    expect(localStorage.getItem("kb.cols.r/deployments")).toBeNull();
  });

  it("exports and imports views as a file teams can keep in git", () => {
    const a = useSavedViews.getState().add(base);
    const b = useSavedViews.getState().add({ ...base, name: "Services", kind: "services", namespaces: [], filter: "type:loadbalancer" });
    const text = exportViews([a, b]);
    expect(JSON.parse(text)).toMatchObject({ kind: "kubebay.savedViews", version: 1 });
    useSavedViews.setState({ views: [] });
    const parsed = parseViewsFile(text);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.views.map((v) => v.name)).toEqual(["Crashing shop pods", "Services"]);
    const res = useSavedViews.getState().importViews(parsed.views);
    expect(res).toEqual({ added: 2, replaced: 0 });
    expect(useSavedViews.getState().views.map((v: SavedView) => v.name)).toEqual(["Crashing shop pods", "Services"]);
    // Importing the same file again replaces rather than duplicates.
    expect(useSavedViews.getState().importViews(parsed.views)).toEqual({ added: 0, replaced: 2 });
    expect(useSavedViews.getState().views).toHaveLength(2);
  });

  it("refuses files that aren't saved views, saying why", () => {
    for (const [text, why] of [
      ["not json", "isn't JSON"],
      [JSON.stringify({ kind: "something", version: 1, views: [] }), "Kubebay saved views"],
      [JSON.stringify({ kind: "kubebay.savedViews", version: 2, views: [] }), "version"],
      [JSON.stringify({ kind: "kubebay.savedViews", version: 1, views: [{ name: "", cluster: "c", kind: "pods", namespaces: [], filter: "" }] }), "view 1"],
      [JSON.stringify({ kind: "kubebay.savedViews", version: 1, views: [{ name: "x", cluster: "c", kind: "../../etc", namespaces: [], filter: "" }] }), "view 1"],
    ] as const) {
      const r = parseViewsFile(text);
      expect("error" in r && r.error).toContain(why);
    }
  });

  // Views live in local storage under kb.views, keyed by cluster ID, so they
  // outlast a restart and a kubeconfig reload alike.
  it("survives a restart", async () => {
    useSavedViews.getState().add(base);
    vi.resetModules();
    const fresh = await import("../savedViews");
    await fresh.useSavedViews.persist.rehydrate();
    expect(fresh.useSavedViews.getState().views.map((v) => v.name)).toEqual(["Crashing shop pods"]);
  });
});
