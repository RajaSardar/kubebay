import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ResourceTable from "../ResourceTable";

// Slice 8 of docs/TABLE_UNIFICATION.md: a resource table's filter finds rows
// by every column it shows (CRD printer columns and Owner too, not only the
// kind's own columns), those columns sort, and each row's menu button is
// named for its row, as on Pods.

const now = new Date().toISOString();
const widgets = [
  { metadata: { name: "alpha", namespace: "shop", creationTimestamp: now }, status: { phase: "Ready" } },
  {
    metadata: { name: "beta", namespace: "shop", creationTimestamp: now, annotations: { "argocd.argoproj.io/instance": "storefront" } },
    status: { phase: "Degraded" },
  },
  { metadata: { name: "gamma", namespace: "data", creationTimestamp: now }, status: { phase: "Pending" } },
];

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows: widgets, synced: true, connected: true }) };
});
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    crdApi: {
      list: vi.fn(async () => [
        { gvr: "example.com/v1/widgets", columns: [{ name: "Phase", jsonPath: ".status.phase", type: "string" }] },
      ]),
    },
  };
});

function renderWidgets() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/r/ext--example.com--v1--widgets"]}>
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const names = () => [...document.querySelectorAll("tbody tr[data-index] .td-name")].map((td) => td.textContent);
const filter = (text: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: /^Filter/ }), { target: { value: text } });

describe("resource tables use every column they show", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("filters by a CRD printer column", async () => {
    renderWidgets();
    await screen.findByRole("columnheader", { name: "Phase" });
    filter("degraded");
    expect(names()).toEqual(["beta"]);
  });

  it("filters by the GitOps owner", async () => {
    renderWidgets();
    await screen.findByRole("columnheader", { name: "Phase" });
    filter("storefront");
    expect(names()).toEqual(["beta"]);
  });

  it("sorts by a printer column and by Owner", async () => {
    renderWidgets();
    fireEvent.click(await screen.findByRole("columnheader", { name: "Phase" }));
    expect(names()).toEqual(["beta", "gamma", "alpha"]);
    fireEvent.click(screen.getByRole("columnheader", { name: "Managed by" }));
    // "–" (no owner) sorts before "Argo CD: storefront"; ties keep name order.
    expect(names()[2]).toBe("beta");
  });

  it("names each row's menu button for its row", async () => {
    renderWidgets();
    await screen.findByRole("columnheader", { name: "Phase" });
    const row = screen.getByText("gamma").closest("tr")!;
    expect(within(row).getByRole("button", { name: "Actions for gamma" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Row actions" })).toBeNull();
  });
});
