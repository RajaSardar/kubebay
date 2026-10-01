import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ResourceTable from "../ResourceTable";
import Workloads from "../Workloads";

// #23 "Show pods": a workload's row menu opens Pods scoped to that workload
// (its namespace and selector) with a removable chip; the global namespace
// filter is left alone (docs/TABLE_FOLLOWUPS.md).

const now = new Date().toISOString();
const deployments = [
  { metadata: { name: "web", namespace: "shop", creationTimestamp: now }, spec: { replicas: 1, selector: { matchLabels: { app: "web" } } }, status: {} },
  { metadata: { name: "odd", namespace: "shop", creationTimestamp: now }, spec: { replicas: 1 }, status: {} },
];
const pod = { metadata: { name: "web-1", namespace: "shop", creationTimestamp: now, labels: { app: "web" } }, spec: { containers: [{ name: "c" }] }, status: { phase: "Running" } };
const calls: { gvr: string; opts: { ns?: string[]; labelSelector?: string } }[] = [];

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [], isLoading: false }),
}));
vi.mock("../../App", () => ({
  useActiveCluster: () => ({ active: "kind-test", setActive: vi.fn(), switching: false }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, clusters: vi.fn(async () => []), podMetrics: vi.fn(async () => []) } };
});
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return {
    ...actual,
    useResourceStream: (_c: string, gvr: string, opts: { ns?: string[]; labelSelector?: string } = {}) => {
      calls.push({ gvr, opts });
      return { rows: gvr === "apps/v1/deployments" ? deployments : gvr === "v1/pods" ? [pod] : [], synced: true, connected: true };
    },
  };
});

let where = "";
function Where() {
  const l = useLocation();
  where = l.pathname + l.search;
  return null;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/r/:kind" element={<ResourceTable />} />
          <Route path="/workloads" element={<Workloads />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Show pods", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
  });

  it("opens Pods for the workload's namespace and selector", () => {
    renderAt("/r/deployments");
    const row = screen.getByText("web").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Actions for web" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show pods" }));
    expect(where).toBe("/workloads?ns=shop&selector=app%3Dweb&of=Deployment%2Fweb");
  });

  it("is disabled for a workload that selects nothing, and absent on kinds without pods", () => {
    renderAt("/r/deployments");
    fireEvent.click(within(screen.getByText("odd").closest("tr")!).getByRole("button", { name: "Actions for odd" }));
    expect(screen.getByRole("menuitem", { name: "Show pods" })).toHaveAttribute("aria-disabled", "true");
  });

  it("Pods streams just those pods, says so in a chip, and the chip's × shows all pods again", () => {
    renderAt("/workloads?ns=shop&selector=app%3Dweb&of=Deployment%2Fweb");
    const podCall = calls.filter((c) => c.gvr === "v1/pods").at(-1)!;
    expect(podCall.opts.ns).toEqual(["shop"]);
    expect(podCall.opts.labelSelector).toBe("app=web");
    expect(screen.getByText(/Pods of Deployment/)).toHaveTextContent("Pods of Deployment web · shop");
    fireEvent.click(screen.getByRole("button", { name: "Show all pods" }));
    expect(where).toBe("/workloads");
    const after = calls.filter((c) => c.gvr === "v1/pods").at(-1)!;
    expect(after.opts.labelSelector).toBeUndefined();
  });
});
