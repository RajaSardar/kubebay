import { beforeEach, describe, expect, it } from "vitest";
import { isNamespaceName, namedNamespaces, namespaceOptions } from "../namespaceAccess";
import { useClusterMeta } from "../cluster-meta-store";

// ADR 0003: an identity that can't list namespaces names the ones it uses.
// The kubeconfig context's namespace comes first, then the ones typed into
// the picker, remembered per cluster.

describe("isNamespaceName", () => {
  it("takes DNS-1123 labels only", () => {
    for (const ok of ["shop", "team-a", "a1", "x"]) expect(isNamespaceName(ok)).toBe(true);
    for (const bad of ["", "Shop", "shop!", "-a", "a-", "a_b", "a".repeat(64)]) expect(isNamespaceName(bad)).toBe(false);
  });
});

describe("namedNamespaces", () => {
  it("puts the context namespace first, then the remembered ones, each once", () => {
    expect(namedNamespaces("shop", ["payments", "shop", "data"])).toEqual(["shop", "payments", "data"]);
    expect(namedNamespaces(undefined, ["payments"])).toEqual(["payments"]);
    expect(namedNamespaces(undefined, [])).toEqual([]);
  });
});

describe("namespaceOptions (Topology's single-namespace list)", () => {
  it("uses the listed namespaces when it can list them", () => {
    expect(namespaceOptions(["b", "a"], false, ["shop"])).toEqual(["a", "b"]);
  });
  it("uses the named ones when it can't, instead of falling back to default", () => {
    expect(namespaceOptions([], true, ["shop", "payments"])).toEqual(["shop", "payments"]);
  });
  it("falls back to default only when there is nothing else", () => {
    expect(namespaceOptions([], true, [])).toEqual(["default"]);
    expect(namespaceOptions([], false, [])).toEqual(["default"]);
  });
});

describe("remembered namespaces", () => {
  beforeEach(() => useClusterMeta.setState({ meta: {} }));
  it("are kept per cluster, each once, and can be forgotten", () => {
    const s = useClusterMeta.getState();
    s.rememberNamespace("c1", "payments");
    s.rememberNamespace("c1", "payments");
    s.rememberNamespace("c1", "data");
    s.rememberNamespace("c2", "other");
    expect(useClusterMeta.getState().meta.c1?.namespaces).toEqual(["payments", "data"]);
    useClusterMeta.getState().forgetNamespace("c1", "payments");
    expect(useClusterMeta.getState().meta.c1?.namespaces).toEqual(["data"]);
    expect(useClusterMeta.getState().meta.c2?.namespaces).toEqual(["other"]);
  });
});
