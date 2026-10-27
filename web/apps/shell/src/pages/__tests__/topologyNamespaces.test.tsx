import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Topology shows one namespace. ADR 0003: an identity that can't list
// namespaces picks from the ones it named, not from "default", which it
// usually can't read either.

const forbidden = new Map<string, string>();
const rows = new Map<string, unknown[]>();

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1", namespace: "shop" }], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) => ({ rows: rows.get(gvr) ?? [], synced: !forbidden.has(gvr), connected: true, forbidden: forbidden.get(gvr) })),
}));
vi.mock("@xyflow/react", () => ({
  ReactFlow: () => null,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  BackgroundVariant: {},
  Position: {},
}));

const { useResourceStream } = await import("../../lib/useResourceStream");
const { useNamespaceStore } = await import("../../lib/namespace-store");
const { useClusterMeta } = await import("../../lib/cluster-meta-store");
const { default: Topology } = await import("../Topology");

function renderTopology() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Topology />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const namespaceChoices = () =>
  within(screen.getByRole("combobox", { name: "namespace" }))
    .getAllByRole("option")
    .map((o) => o.textContent);

describe("Topology's namespace", () => {
  beforeEach(() => {
    forbidden.clear();
    rows.clear();
    vi.mocked(useResourceStream).mockClear();
    useNamespaceStore.setState({ selections: {} });
    useClusterMeta.setState({ meta: {} });
  });

  it("offers the named namespaces when namespaces can't be listed, and reads the first", () => {
    forbidden.set("v1/namespaces", 'namespaces is forbidden: User "dev" cannot list resource "namespaces"');
    useClusterMeta.getState().rememberNamespace("c1", "payments");
    renderTopology();
    expect(namespaceChoices()).toEqual(["shop", "payments"]);
    expect(useResourceStream).toHaveBeenCalledWith("c1", "v1/pods", { mode: "full", ns: ["shop"] });
  });

  it("still lists every namespace for an identity that can", () => {
    rows.set("v1/namespaces", [{ metadata: { name: "kube-system" } }, { metadata: { name: "default" } }]);
    renderTopology();
    expect(namespaceChoices()).toEqual(["default", "kube-system"]);
  });
});
