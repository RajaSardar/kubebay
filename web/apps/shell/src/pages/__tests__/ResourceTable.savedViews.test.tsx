import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ResourceTable from "../ResourceTable";
import { useSavedViews } from "../../lib/savedViews";
import { useNamespaceStore } from "../../lib/namespace-store";

const now = new Date().toISOString();
const obj = (ns: string, name: string) => ({ metadata: { name, namespace: ns, creationTimestamp: now }, spec: {}, status: {} });

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows: [obj("shop", "web"), obj("shop", "api")], synced: true, connected: true }) };
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ResourceTable: saved views (KB-16)", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => {
    localStorage.clear();
    useSavedViews.setState({ views: [] });
    useNamespaceStore.setState({ selections: {} });
  });

  it("starts with the link's ?q= filter", () => {
    renderAt("/r/deployments?q=name:api");
    expect(screen.getByDisplayValue("name:api")).toBeInTheDocument();
    expect(screen.queryByText("web")).toBeNull();
    expect(screen.getByText("api")).toBeInTheDocument();
  });

  it("saves what the table shows as a named view", () => {
    useNamespaceStore.setState({ selections: { "kind-test": ["shop"] } });
    localStorage.setItem("kb.sort.r/deployments", JSON.stringify({ col: "Age", asc: false }));
    renderAt("/r/deployments?q=name:api");
    fireEvent.change(screen.getByDisplayValue("name:api"), { target: { value: "name:web" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    const dialog = screen.getByRole("dialog", { name: "Save view" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "View name" }), { target: { value: "Shop web" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(useSavedViews.getState().views).toEqual([
      expect.objectContaining({ name: "Shop web", cluster: "kind-test", kind: "deployments", namespaces: ["shop"], filter: "name:web", sort: { col: "Age", asc: false } }),
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
