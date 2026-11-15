import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Workloads from "../Workloads";
import type { ExtensionsFile } from "../../lib/api";

// KB-13: extension columns and actions on the Pods table, which shows derived
// rows, so the extension reads the pod object behind each one.

const now = new Date().toISOString();
const rows = [
  {
    metadata: { name: "api-1", namespace: "shop", creationTimestamp: now, labels: { app: "api" } },
    spec: { nodeName: "node-1", containers: [{ name: "app" }] },
    status: { phase: "Running", hostIP: "192.168.1.7", containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: { running: {} } }] },
  },
];

let file: ExtensionsFile;
vi.mock("../../App", () => ({
  useActiveCluster: () => ({ active: "kind-test", setActive: vi.fn(), switching: false }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    api: { ...actual.api, clusters: vi.fn(async () => [{ id: "kind-test", context: "kind-dev", server: "", status: "reachable" }]), podMetrics: vi.fn(async () => []) },
    extensionsApi: { get: vi.fn(async () => file) },
  };
});
vi.mock("../../lib/useResourceStream", async () => {
  const actual = await vi.importActual<typeof import("../../lib/useResourceStream")>("../../lib/useResourceStream");
  return { ...actual, useResourceStream: () => ({ rows, synced: true, connected: true }) };
});

function Where() {
  return <pre data-testid="terminal-state">{JSON.stringify(useLocation().state)}</pre>;
}

function renderPods() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/workloads"]}>
        <Routes>
          <Route path="/workloads" element={<Workloads />} />
          <Route path="/terminal" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("extensions on the Pods table", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => {
    localStorage.clear();
    file = {
      path: "/h/.kubebay/extensions.yaml",
      exists: true,
      errors: [],
      columns: [{ resource: "pods", header: "Host IP", jsonPath: ".status.hostIP" }],
      actions: [{ resource: "pods", label: "Tail with stern", run: "stern -n {{namespace}} {{name}} --context {{context}}" }],
      commands: { available: true, shell: "bash" },
    };
  });

  it("shows a column read from the pod object", async () => {
    renderPods();
    await screen.findByRole("columnheader", { name: "Host IP" });
    expect(screen.getByText("192.168.1.7")).toBeInTheDocument();
  });

  it("offers the row action with the pod's own values", async () => {
    renderPods();
    await screen.findByRole("columnheader", { name: "Host IP" });
    const tr = screen.getByText("api-1").closest("tr")!;
    fireEvent.click(within(tr).getByRole("button", { name: "Actions for api-1" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Tail with stern" }));
    const state = JSON.parse((await screen.findByTestId("terminal-state")).textContent ?? "null");
    expect(state.prefill).toEqual({ cluster: "kind-test", command: "stern -n 'shop' 'api-1' --context 'kind-dev'", label: "Tail with stern" });
  });
});
