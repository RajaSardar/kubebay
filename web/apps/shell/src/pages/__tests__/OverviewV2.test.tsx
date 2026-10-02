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
  useResourceStream: (_c: string, gvr: string) => ({ rows: streams[gvr] ?? [], synced: true }),
  shouldShowSkeleton: () => false,
}));

function crashing(name: string): Obj {
  return {
    metadata: { name, namespace: "shop", creationTimestamp: now, labels: { "pod-template-hash": "7f9" }, ownerReferences: [{ kind: "ReplicaSet", name: "api-7f9", controller: true }] },
    spec: { containers: [{ name: "api", resources: { requests: { cpu: "1", memory: "2Gi" } } }], nodeName: "n1" },
    status: { phase: "Running", containerStatuses: [{ name: "api", ready: false, restartCount: 4, state: { waiting: { reason: "CrashLoopBackOff" } } }] },
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkloadsOverview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Overview v2", () => {
  beforeEach(() => {
    selectedNs = [];
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
});
