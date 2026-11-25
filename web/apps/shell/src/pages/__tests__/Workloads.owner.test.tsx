import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { podNameText } from "../../testing/podName";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Workloads from "../Workloads";

// Backlog 54: the Pods list's Owner column. A pod of a Deployment reads
// "Deployment/web" (through its ReplicaSet), a bare pod a dash.

const now = new Date().toISOString();
function pod(name: string, refs?: Record<string, unknown>[]) {
  return {
    metadata: { name, namespace: "shop", creationTimestamp: now, ownerReferences: refs },
    spec: { nodeName: "node-1", containers: [{ name: "app" }] },
    status: { phase: "Running", containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: { running: {} } }] },
  };
}
const pods = [
  pod("web-1-abc", [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "web-1", controller: true }]),
  pod("db-0", [{ apiVersion: "apps/v1", kind: "StatefulSet", name: "db", controller: true }]),
  pod("bare"),
];
const replicaSets = [
  { metadata: { name: "web-1", namespace: "shop", ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name: "web", controller: true }] } },
];

const navigate = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigate,
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
    useResourceStream: (_c: unknown, gvr: string) => ({
      rows: gvr === "apps/v1/replicasets" ? replicaSets : pods,
      synced: true,
      connected: true,
    }),
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
const rowOf = (name: string) => screen.getByText(podNameText(name)).closest("tr")!;

describe("Pods: Owner column", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  beforeEach(() => {
    localStorage.clear();
    navigate.mockClear();
  });

  it("shows the Deployment above a pod's ReplicaSet, the direct owner otherwise, a dash for a bare pod", () => {
    renderPods();
    expect(screen.getByRole("columnheader", { name: /Owner/ })).toBeInTheDocument();
    expect(rowOf("web-1-abc")).toHaveTextContent("Deployment/web");
    expect(rowOf("db-0")).toHaveTextContent("StatefulSet/db");
    expect(rowOf("bare")).toHaveTextContent("—");
  });

  it("links the owner to its drawer without opening the pod", () => {
    renderPods();
    fireEvent.click(screen.getByText("Deployment/web"));
    expect(navigate).toHaveBeenCalledWith("/detail/deployments/shop/web");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filters by the owner's kind", () => {
    renderPods();
    fireEvent.change(screen.getByRole("textbox", { name: /^Filter/ }), { target: { value: "controller:statefulset" } });
    expect(screen.queryByText(podNameText("web-1-abc"))).toBeNull();
    expect(screen.getByText(podNameText("db-0"))).toBeInTheDocument();
  });
});
