import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useNamespaceStore } from "../namespace-store";
import { useClusterMeta } from "../cluster-meta-store";

// Mounted once in the shell: when the cluster won't list namespaces and
// nothing is selected, select the ones the person named, so every page that
// honours the selection subscribes where it can actually read.
const stream = vi.hoisted(() => ({ value: { rows: [] as unknown[], synced: true, forbidden: undefined as string | undefined } }));
vi.mock("../useResourceStream", () => ({ useResourceStream: () => stream.value }));

const { useNamespaceFallback } = await import("../namespaceAccess");

function wrapper(clusters: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["clusters"], clusters);
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useNamespaceFallback", () => {
  beforeEach(() => {
    useNamespaceStore.setState({ selections: {} });
    useClusterMeta.setState({ meta: {} });
  });

  it("selects the context namespace and the remembered ones when namespaces can't be listed", () => {
    stream.value = { rows: [], synced: false, forbidden: 'namespaces is forbidden: User "dev" cannot list resource "namespaces"' };
    useClusterMeta.getState().rememberNamespace("limited", "payments");
    renderHook(() => useNamespaceFallback("limited"), { wrapper: wrapper([{ id: "limited", namespace: "shop" }]) });
    expect(useNamespaceStore.getState().selections.limited).toEqual(["shop", "payments"]);
  });

  it("leaves an admin's selection alone", () => {
    stream.value = { rows: [{ metadata: { name: "shop" } }], synced: true, forbidden: undefined };
    renderHook(() => useNamespaceFallback("admin"), { wrapper: wrapper([{ id: "admin", namespace: "shop" }]) });
    expect(useNamespaceStore.getState().selections.admin).toBeUndefined();
  });

  it("keeps a selection the person already made", () => {
    stream.value = { rows: [], synced: false, forbidden: "namespaces is forbidden" };
    useNamespaceStore.getState().setNamespaces("limited", ["data"]);
    renderHook(() => useNamespaceFallback("limited"), { wrapper: wrapper([{ id: "limited", namespace: "shop" }]) });
    expect(useNamespaceStore.getState().selections.limited).toEqual(["data"]);
  });

  it("the shell mounts it for the active cluster", () => {
    const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");
    expect(app).toMatch(/useNamespaceFallback\(effectiveActive \|\| undefined\)/);
  });
});
