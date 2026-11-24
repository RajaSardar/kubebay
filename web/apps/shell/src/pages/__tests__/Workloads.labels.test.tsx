import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { podNameText } from "../../testing/podName";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Workloads from "../Workloads";

// Backlog 65: the Pods list's Labels column, in the column chooser and hidden
// by default; label:key=value filtering already exists.

const now = new Date().toISOString();
function pod(name: string, labels: Record<string, string>) {
  return {
    metadata: { name, namespace: "shop", creationTimestamp: now, labels },
    spec: { nodeName: "node-1", containers: [{ name: "app" }] },
    status: { phase: "Running", containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: { running: {} } }] },
  };
}
const pods = [pod("web-1", { app: "web", tier: "front" }), pod("db-0", { app: "db" })];

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
    useResourceStream: (_c: unknown, gvr: string) => ({ rows: gvr === "v1/pods" ? pods : [], synced: true, connected: true }),
  };
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

describe("Pods: Labels column", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("is in the column chooser, hidden until chosen, then shows each pod's labels", () => {
    renderPods();
    expect(screen.queryByRole("columnheader", { name: /Labels/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Labels" }));
    expect(screen.getByRole("columnheader", { name: /Labels/ })).toBeInTheDocument();
    const row = screen.getByText(podNameText("web-1")).closest("tr")!;
    expect(row).toHaveTextContent("app=web");
    expect(row).toHaveTextContent("tier=front");
  });

  it("filters on the labels column text", () => {
    renderPods();
    fireEvent.change(screen.getByRole("textbox", { name: /^Filter/ }), { target: { value: "labels:tier=front" } });
    expect(screen.queryByText(podNameText("db-0"))).toBeNull();
    expect(screen.getByText(podNameText("web-1"))).toBeInTheDocument();
  });
});
