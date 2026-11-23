import { beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Workloads from "../Workloads";

// Perf pass 3: at 2,000 pods and 500 ReplicaSets, a stream flush that hands
// Workloads a rebuilt rows array of the same objects derives no pod rows, and
// a flush with one changed pod derives one. Counts reads of `status` (derivePod
// reads it once per pod), not time.

type Obj = Record<string, unknown>;
let statusReads = 0;
function pod(i: number, rv = "1"): Obj {
  const rs = `app-${i % 500}-h`;
  return new Proxy(
    {
      metadata: {
        name: `${rs}-${i}`,
        namespace: `ns-${i % 50}`,
        creationTimestamp: "2026-11-01T00:00:00Z",
        resourceVersion: rv,
        ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: rs, controller: true }],
      },
      spec: { nodeName: "node-1", containers: [{ name: "app" }] },
      status: { phase: "Running", containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: { running: {} } }] },
    } as Obj,
    {
      get(t, k, r) {
        if (k === "status") statusReads++;
        return Reflect.get(t, k, r);
      },
    },
  );
}
const replicaSets = Array.from({ length: 500 }, (_, i) => ({
  metadata: {
    name: `app-${i}-h`,
    namespace: `ns-${i % 50}`,
    ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name: `app-${i}`, controller: true }],
  },
}));
const stream = { pods: Array.from({ length: 2000 }, (_, i) => pod(i)) };

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
      rows: gvr === "apps/v1/replicasets" ? replicaSets : stream.pods,
      synced: true,
      connected: true,
    }),
  };
});

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tree = () => (
  <QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={["/workloads"]}>
      <Workloads />
    </MemoryRouter>
  </QueryClientProvider>
);

describe("Workloads at 2,000 pods and 500 ReplicaSets: derivations per flush", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  it("derives nothing on an unchanged flush and one pod when one changed", () => {
    const r = render(tree());
    expect(r.getAllByText("Deployment/app-0").length).toBeGreaterThan(0);

    statusReads = 0;
    stream.pods = [...stream.pods];
    r.rerender(tree());
    expect(statusReads).toBe(0);

    stream.pods = [...stream.pods];
    stream.pods[3] = pod(3, "2");
    statusReads = 0;
    r.rerender(tree());
    expect(statusReads).toBe(1);
  });
});
