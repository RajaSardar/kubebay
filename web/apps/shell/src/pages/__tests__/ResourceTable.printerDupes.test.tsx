import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ResourceTable from "../ResourceTable";

// Backlog 31: a CRD whose printer columns include "Age" (KEDA's ScaledObject
// does) must not show a second Age beside the table's own.

const now = new Date().toISOString();
const rows = [{ metadata: { name: "alpha", namespace: "shop", creationTimestamp: now }, status: { phase: "Ready" } }];

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows, synced: true, connected: true }) };
});
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    crdApi: {
      list: vi.fn(async () => [
        {
          gvr: "example.com/v1/widgets",
          columns: [
            { name: "Phase", jsonPath: ".status.phase", type: "string" },
            { name: "Age", jsonPath: ".metadata.creationTimestamp", type: "date" },
            { name: "Namespace", jsonPath: ".metadata.namespace", type: "string" },
            { name: "Name", jsonPath: ".metadata.name", type: "string" },
          ],
        },
      ]),
    },
  };
});

describe("CRD printer columns that repeat built-in ones", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("shows Age, Name and Namespace once", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/r/ext--example.com--v1--widgets"]}>
          <Routes>
            <Route path="/r/:kind" element={<ResourceTable />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("columnheader", { name: "Phase" });
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    for (const n of ["Age", "Name", "Namespace"]) expect(heads.filter((h) => h === n)).toHaveLength(1);
  });
});
