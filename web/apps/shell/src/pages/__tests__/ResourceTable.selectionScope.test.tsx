import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import ResourceTable from "../ResourceTable";
import { ResourceListView } from "../../components/ResourceListView";

// Every /r/:kind table is the same mounted component. A selection made on
// Deployments must not survive the switch to Services, or "Delete 1 selected"
// there would delete the Service that happens to share the Deployment's name.
// Rows the stream removes must leave the selection too.

const now = new Date().toISOString();
const obj = (ns: string, name: string) => ({ metadata: { name, namespace: ns, creationTimestamp: now }, spec: {}, status: {} });
const byGvr: Record<string, unknown[]> = {
  "apps/v1/deployments": [obj("shop", "web"), obj("shop", "api")],
  "v1/services": [obj("shop", "web"), obj("shop", "api")],
};

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: (_c: string, gvr: string) => ({ rows: byGvr[gvr] ?? [], synced: true, connected: true }) };
});

let go: (to: string) => void = () => {};
function Nav() {
  go = useNavigate();
  return null;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Nav />
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a selection belongs to one table", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it("is cleared when you switch to another kind", () => {
    renderAt("/r/deployments");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    act(() => go("/r/services"));
    expect(screen.getByRole("heading", { name: /Services/ })).toBeInTheDocument();
    expect(screen.queryByText("1 selected")).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete 1 selected/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select web" })).not.toBeChecked();
  });

  it("drops an open delete confirmation when you switch kinds", () => {
    renderAt("/r/deployments");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 selected" }));
    expect(screen.getByText(/can.t be undone/)).toBeInTheDocument();
    act(() => go("/r/services"));
    expect(screen.queryByText(/can.t be undone/)).toBeNull();
  });

  it("drops rows the stream removed", () => {
    const props = (rows: { name: string }[]) => ({
      title: "Jobs",
      label: "Jobs",
      rows,
      objects: [],
      synced: true,
      busy: false,
      live: true,
      cluster: "kind-test",
      nsFiltered: false,
      nameOf: (r: { name: string }) => r.name,
      nsOf: () => "shop",
      createdOf: () => now,
      columns: [],
      sortKey: "test/prune",
      onOpen: () => {},
      menuItems: () => [],
      onDelete: () => Promise.resolve(),
    });
    const view = render(<ResourceListView {...props([{ name: "web" }, { name: "api" }])} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select web" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select api" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    view.rerender(<ResourceListView {...props([{ name: "api" }])} />);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete 1 selected" })).toBeInTheDocument();
  });
});
