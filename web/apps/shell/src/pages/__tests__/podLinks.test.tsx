import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Workloads from "../Workloads";

// Overview v2 links into Pods: ?q= opens the list already filtered (a status
// bar segment), and ?pod=ns/name&tab=logs opens that pod's drawer on its logs
// (a Needs attention row's "Show logs").

const now = new Date().toISOString();
const pods = [
  {
    metadata: { name: "api-1", namespace: "shop", creationTimestamp: now },
    spec: { containers: [{ name: "api" }] },
    status: { phase: "Running", containerStatuses: [{ name: "api", ready: false, restartCount: 9, state: { waiting: { reason: "CrashLoopBackOff" } } }] },
  },
  {
    metadata: { name: "web-1", namespace: "shop", creationTimestamp: now },
    spec: { containers: [{ name: "web" }] },
    status: { phase: "Running", containerStatuses: [{ name: "web", ready: true, restartCount: 0, state: { running: {} } }] },
  },
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
  return { ...actual, useResourceStream: (_c: string, gvr: string) => ({ rows: gvr === "v1/pods" ? pods : [], synced: true, connected: true }) };
});
vi.mock("../PodPanel", () => ({
  default: ({ pod }: { pod: { namespace: string; pod: string; tab?: string } }) => (
    <div data-testid="pod-panel">{`${pod.namespace}/${pod.pod} on ${pod.tab ?? "default"}`}</div>
  ),
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/workloads" element={<Workloads />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("links into Pods", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => localStorage.clear());

  it("?q= opens the list already filtered", () => {
    renderAt("/workloads?q=status%3ACrashLoopBackOff");
    expect(screen.getByRole("textbox", { name: "Filter pods" })).toHaveValue("status:CrashLoopBackOff");
    expect(screen.getByText("api-1")).toBeInTheDocument();
    expect(screen.queryByText("web-1")).not.toBeInTheDocument();
  });

  it("?pod=ns/name&tab=logs opens that pod's drawer on its logs", () => {
    renderAt("/workloads?pod=shop%2Fapi-1&tab=logs");
    expect(screen.getByTestId("pod-panel")).toHaveTextContent("shop/api-1 on logs");
  });

  it("?pod= for a pod that is not in the list opens nothing", () => {
    renderAt("/workloads?pod=shop%2Fgone");
    expect(screen.queryByTestId("pod-panel")).not.toBeInTheDocument();
  });
});
