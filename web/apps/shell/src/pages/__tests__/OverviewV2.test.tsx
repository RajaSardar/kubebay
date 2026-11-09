import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkloadsOverview from "../WorkloadsOverview";

// Overview v2 (docs/OVERVIEW_V2.md): new blocks are added to the Overview tab;
// everything it already had stays.

const now = new Date().toISOString();
type Obj = Record<string, unknown>;
let streams: Record<string, Obj[]> = {};
// Streams that haven't delivered their first list yet, and ones RBAC forbids.
let unsynced = new Set<string>();
let forbidden: Record<string, string> = {};
let selectedNs: string[] = [];

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  crdApi: { list: vi.fn(async () => []) },
}));
vi.mock("../../lib/namespace-store", async (orig) => ({
  ...(await orig<typeof import("../../lib/namespace-store")>()),
  useSelectedNamespaces: () => selectedNs,
}));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: (_c: string, gvr: string) => ({
    rows: streams[gvr] ?? [],
    synced: !unsynced.has(gvr) && !forbidden[gvr],
    forbidden: forbidden[gvr],
  }),
  shouldShowSkeleton: () => false,
}));

function crashing(name: string): Obj {
  return {
    metadata: { name, namespace: "shop", creationTimestamp: now, labels: { "pod-template-hash": "7f9" }, ownerReferences: [{ kind: "ReplicaSet", name: "api-7f9", controller: true }] },
    spec: { containers: [{ name: "api", resources: { requests: { cpu: "1", memory: "2Gi" } } }], nodeName: "n1" },
    status: { phase: "Running", containerStatuses: [{ name: "api", ready: false, restartCount: 4, state: { waiting: { reason: "CrashLoopBackOff" } } }] },
  };
}

function page(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkloadsOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage() {
  return render(page());
}

describe("Overview v2", () => {
  beforeEach(() => {
    selectedNs = [];
    unsynced = new Set();
    forbidden = {};
    streams = {
      "v1/pods": [crashing("api-7f9-a")],
      "apps/v1/deployments": [{ metadata: { name: "api", namespace: "shop" }, spec: { replicas: 2, selector: { matchLabels: { app: "api" } } }, status: { readyReplicas: 1 } }],
      "v1/nodes": [{ metadata: { name: "n1" }, spec: {}, status: { allocatable: { cpu: "4", memory: "8Gi" }, conditions: [{ type: "Ready", status: "True" }] } }],
    };
  });

  it("keeps the per-kind cards", () => {
    renderPage();
    for (const kind of ["Pods", "Deployments", "StatefulSets", "DaemonSets", "Jobs", "Nodes"]) {
      expect(screen.getByText(kind, { selector: "strong" })).toBeInTheDocument();
    }
  });

  it("lists broken workloads under Needs attention", () => {
    renderPage();
    const section = screen.getByRole("region", { name: /Needs attention/ });
    const row = within(section).getByText("api").closest("tr")!;
    expect(within(row).getByText("Keeps crashing on start")).toBeInTheDocument();
    expect(within(row).getByText("1 of 2")).toBeInTheDocument();
  });

  it("is calm when nothing is broken", () => {
    streams["v1/pods"] = [];
    streams["apps/v1/deployments"] = [];
    renderPage();
    expect(within(screen.getByRole("region", { name: /Needs attention/ })).getByText("Nothing needs attention")).toBeInTheDocument();
  });

  it("ends with how much of the cluster is requested", () => {
    renderPage();
    const section = screen.getByRole("region", { name: "Capacity" });
    expect(within(section).getByText("CPU 25% · memory 25% requested of allocatable")).toBeInTheDocument();
  });

  it("opens with the verdict: word, count with denominator, worst workload", () => {
    renderPage();
    const region = screen.getByRole("region", { name: "Cluster health" });
    expect(within(region).getByText("Failing")).toBeInTheDocument();
    expect(within(region).getByText("1 of 1 pods need attention · shop/api: Keeps crashing on start")).toBeInTheDocument();
  });

  it("judges your namespaces and offers the rest with one click", () => {
    selectedNs = ["pay"];
    renderPage();
    const region = screen.getByRole("region", { name: "Cluster health" });
    expect(within(region).getByText("Healthy")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Needs attention/ })).getByText("Nothing needs attention")).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "+1 outside your namespaces" }));
    expect(within(screen.getByRole("region", { name: /Needs attention/ })).getByText("api")).toBeInTheDocument();
  });

  it("shows pods by status, and a rollout while one is running", () => {
    streams["apps/v1/deployments"] = [
      {
        metadata: { name: "api", namespace: "shop", generation: 2 },
        spec: { replicas: 2, selector: { matchLabels: { app: "api" } } },
        status: { observedGeneration: 2, readyReplicas: 1, updatedReplicas: 1, conditions: [{ type: "Progressing", status: "True", reason: "ReplicaSetUpdated" }] },
      },
    ];
    renderPage();
    expect(within(screen.getByRole("region", { name: /Pods by status/ })).getByRole("link", { name: "CrashLoopBackOff 1" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Rollouts in progress/ })).getByText("1 of 2 updated · 1 ready")).toBeInTheDocument();
  });

  it("ranks namespaces below the fold", () => {
    streams["v1/pods"] = [crashing("api-7f9-a"), { metadata: { name: "w", namespace: "pay" }, spec: { nodeName: "n1", containers: [{ name: "c" }] }, status: { phase: "Running" } }];
    renderPage();
    const section = screen.getByRole("region", { name: /Namespaces/ });
    expect(within(section).getByText("1 broken · 0 warnings · 1 pods")).toBeInTheDocument();
  });

  // Regression: right after connecting, the verdict said "Healthy · All 0 pods
  // healthy" and "Nothing needs attention" before the pods had loaded.
  it("claims nothing about health until the pods have loaded", () => {
    unsynced = new Set(["v1/pods"]);
    streams["v1/pods"] = [];
    renderPage();
    const region = screen.getByRole("region", { name: "Cluster health" });
    expect(within(region).queryByText("Healthy")).not.toBeInTheDocument();
    expect(within(region).queryByText(/pods healthy/)).not.toBeInTheDocument();
    expect(within(region).getByText("Checking")).toBeInTheDocument();
    const attention = screen.getByRole("region", { name: /Needs attention/ });
    expect(within(attention).queryByText("Nothing needs attention")).not.toBeInTheDocument();
    expect(within(attention).getByText(/Loading pods/)).toBeInTheDocument();
  });

  it("gives the verdict as soon as the pods load, not a throttle window later", () => {
    unsynced = new Set(["v1/pods"]);
    const loaded = streams["v1/pods"]!;
    streams["v1/pods"] = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(page(qc));
    unsynced = new Set();
    streams["v1/pods"] = loaded;
    rerender(page(qc));
    const region = screen.getByRole("region", { name: "Cluster health" });
    expect(within(region).getByText("Failing")).toBeInTheDocument();
    expect(within(region).getByText("1 of 1 pods need attention · shop/api: Keeps crashing on start")).toBeInTheDocument();
  });

  it("says it can't judge, never Healthy, when RBAC forbids listing pods", () => {
    forbidden = { "v1/pods": "pods is forbidden: User \"dev\" cannot list resource \"pods\"" };
    streams["v1/pods"] = [];
    renderPage();
    const region = screen.getByRole("region", { name: "Cluster health" });
    expect(within(region).queryByText("Healthy")).not.toBeInTheDocument();
    expect(within(region).getByText("Unknown")).toBeInTheDocument();
    expect(within(region).getByText("Can't check pod health: listing pods is forbidden")).toBeInTheDocument();
    const attention = screen.getByRole("region", { name: /Needs attention/ });
    expect(within(attention).queryByText("Nothing needs attention")).not.toBeInTheDocument();
  });
});
