import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Workloads from "../Workloads";

// Pods on the shared list view (slice 7 of docs/TABLE_UNIFICATION.md), with
// the approved changes: count in the header, dimmed terminating pods, mouse
// hover, one empty-state wording. Pods keeps its own columns and menu.

const now = new Date().toISOString();
function pod(ns: string, name: string, over: { node?: string; restarts?: number; terminating?: boolean } = {}) {
  return {
    metadata: { name, namespace: ns, creationTimestamp: now, ...(over.terminating ? { deletionTimestamp: now } : {}) },
    spec: { nodeName: over.node ?? "node-1", containers: [{ name: "app" }] },
    status: {
      phase: "Running",
      podIP: "10.0.0.1",
      containerStatuses: [{ name: "app", ready: true, restartCount: over.restarts ?? 0, state: { running: {} } }],
    },
  };
}
const rows = [
  pod("shop", "web-b", { restarts: 3 }),
  pod("data", "redis-a", { node: "node-7" }),
  pod("shop", "web-a", { terminating: true }),
];

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
const names = () => [...document.querySelectorAll("tbody tr[data-index] .td-name")].map((td) => td.textContent);
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

describe("Pods on the shared list view", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("counts pods in the page header, not the toolbar", () => {
    const { container } = renderPods();
    const header = container.querySelector(".page-header") as HTMLElement;
    expect(within(header).getByText("3")).toHaveClass("kb-badge");
    expect(container.querySelector(".toolbar .kb-badge")).toBeNull();
  });

  it("dims a terminating pod", () => {
    renderPods();
    expect(rowOf("web-a")).toHaveAttribute("data-terminating");
    expect(rowOf("web-b")).not.toHaveAttribute("data-terminating");
  });

  it("highlights the row under the mouse", () => {
    renderPods();
    fireEvent.mouseEnter(rowOf("redis-a"));
    expect(rowOf("redis-a")).toHaveClass("hovered");
    fireEvent.mouseLeave(rowOf("redis-a"));
    expect(rowOf("redis-a")).not.toHaveClass("hovered");
  });

  it("says why the list is empty in the resource tables' words", () => {
    renderPods();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter pods" }), { target: { value: "nope" } });
    expect(screen.getByText("No pods match.")).toBeInTheDocument();
    expect(screen.getByText("Loosen the filters.")).toBeInTheDocument();
  });

  it("keeps its own order, columns, filter and menu", () => {
    renderPods();
    // Namespace, then name.
    expect(names()).toEqual(["redis-a", "web-a", "web-b"]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["", "Name", "Namespace", "Ready", "Status", "Restarts", "Node", "IP", "CPU", "Memory", "Age", ""]);
    expect(within(rowOf("web-b")).getByText("3")).toHaveClass("restart-warn");
    expect(within(rowOf("redis-a")).getByText("node-7")).toHaveAttribute("title", "node-7");
    // The filter reaches the node column.
    fireEvent.change(screen.getByRole("textbox", { name: "Filter pods" }), { target: { value: "node-7" } });
    expect(names()).toEqual(["redis-a"]);
    fireEvent.click(within(rowOf("redis-a")).getByRole("button", { name: "Actions for redis-a" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "View details", "Logs", "Shell", "Edit YAML", "Copy name", "Delete",
    ]);
  });
});
