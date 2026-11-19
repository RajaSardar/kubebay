import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ResourceTable from "../ResourceTable";

// Backlog 54: an Owner column from ownerReferences on the generic tables.
// Shown by default on ReplicaSets, available (hidden) on the other kinds.

const now = new Date().toISOString();
const own = (kind: string, name: string, apiVersion = "apps/v1") => [{ apiVersion, kind, name, controller: true }];
const replicaSets = [
  { metadata: { name: "web-1", namespace: "shop", creationTimestamp: now, ownerReferences: own("Deployment", "web") } },
  { metadata: { name: "api-1", namespace: "shop", creationTimestamp: now, ownerReferences: own("Rollout", "api", "argoproj.io/v1alpha1") } },
  { metadata: { name: "loose", namespace: "shop", creationTimestamp: now } },
];
const jobs = [{ metadata: { name: "nightly-1", namespace: "shop", creationTimestamp: now, ownerReferences: own("CronJob", "nightly", "batch/v1") } }];
let rows: unknown[] = replicaSets;

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows, synced: true, connected: true }) };
});

function renderKind(kind: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/r/${kind}`]}>
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

describe("Owner column on resource tables", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("shows on ReplicaSets: Deployment, Rollout (a CRD) and a dash", () => {
    rows = replicaSets;
    renderKind("replicasets");
    expect(screen.getByRole("columnheader", { name: /^Owner/ })).toBeInTheDocument();
    expect(rowOf("web-1")).toHaveTextContent("Deployment/web");
    expect(rowOf("api-1")).toHaveTextContent("Rollout/api");
    expect(rowOf("loose")).toHaveTextContent("—");
  });

  it("is hidden by default on Jobs, where a CronJob owns the run", () => {
    rows = jobs;
    renderKind("jobs");
    expect(screen.queryByRole("columnheader", { name: /^Owner/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Managed by/ })).toBeInTheDocument();
  });
});
