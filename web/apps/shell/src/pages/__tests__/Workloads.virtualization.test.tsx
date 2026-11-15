import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Workloads from "../Workloads";

// The Pods table mounted every row: 5,000 pods meant 5,000 <tr>s, each with a
// status pill, meters and a menu button, re-rendered on every stream delta.
// The resource tables window their rows; Pods now does the same, with space
// for off-screen rows as real spacer <tr>s (see ResourceTable.virtualization).

function makePod(i: number) {
  return {
    metadata: { name: `pod-${String(i).padStart(4, "0")}`, namespace: "shop", creationTimestamp: new Date().toISOString() },
    spec: { nodeName: "node-1", containers: [{ name: "app" }] },
    status: { phase: "Running", podIP: "10.0.0.1", containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: { running: {} } }] },
  };
}
const rows = Array.from({ length: 500 }, (_, i) => makePod(i));

vi.mock("../../App", () => ({
  useActiveCluster: () => ({ active: "kind-test", setActive: vi.fn(), switching: false }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, clusters: vi.fn(async () => []), podMetrics: vi.fn(async () => []) } };
});
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows, synced: true, connected: true }) };
});

function renderPods() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/workloads"]}>
        <Workloads />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Pods table virtualisation", () => {
  beforeAll(() => {
    // jsdom has no layout: give the scroll container a real viewport height.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it("mounts only the rows in view, and spacer rows carry the rest of the height", () => {
    renderPods();
    const tbody = screen.getByRole("table").querySelector("tbody")!;
    const trs = [...tbody.querySelectorAll("tr")];
    const data = trs.filter((tr) => tr.hasAttribute("data-index"));
    const spacers = trs.filter((tr) => !tr.hasAttribute("data-index"));
    expect(data.length).toBeGreaterThan(0);
    expect(data.length).toBeLessThan(100);
    expect(spacers.length).toBeGreaterThan(0);
    for (const s of spacers) expect(s.style.height).toBeTruthy();
    expect(tbody.style.paddingTop).toBeFalsy();
  });

  it("still counts every pod in the header", () => {
    renderPods();
    expect(screen.getAllByText("500").length).toBeGreaterThan(0);
  });
});
