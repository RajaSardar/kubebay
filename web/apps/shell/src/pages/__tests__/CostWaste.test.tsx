import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CostWaste from "../CostWaste";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

const node = {
  metadata: { name: "n1" },
  status: { allocatable: { cpu: "4", memory: "16Gi" }, conditions: [{ type: "Ready", status: "True" }] },
};
const pod = {
  metadata: { name: "p1", namespace: "a" },
  spec: { nodeName: "n1", containers: [{ name: "c", resources: { requests: { cpu: "3200m", memory: "13108Mi" } } }] },
};

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) => ({
    rows: gvr === "v1/nodes" ? [node] : gvr === "v1/pods" ? [pod] : [],
    synced: true,
  })),
  shouldShowSkeleton: () => false,
}));

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  wasteApi: { workloads: vi.fn(async () => []) },
  historyApi: {
    status: vi.fn(async () => ({
      cluster: "c1", available: true, recording: true,
      coverage: { observedHours: 12, expectedHours: 840, label: "observed 09–18 local, weekdays only" },
    })),
    // Five weekdays, four well-sampled hours each; CPU requests' daily peak rises 200m/day to 3600m.
    series: vi.fn(async () => ({
      ns: "", source: "local",
      coverage: { label: "observed 09–12 local, weekdays only" },
      points: [1, 2, 3, 4, 5].flatMap((d, i) =>
        [9, 10, 11, 12].map((h) => ({
          t: new Date(2026, 8, d, h).toISOString(), n: 60, wellSampled: true,
          cpuMean: null, cpuMax: null, memMean: null, memMax: null, reqCpuMillis: 2800 + i * 200, reqMemBytes: null,
        })),
      ),
    })),
  },
}));

describe("CostWaste", () => {
  it("shows the cluster efficiency score above the waste breakdown", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CostWaste />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Efficiency score")).toBeInTheDocument();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
    expect(screen.getByText("Good")).toBeInTheDocument();
  });

  it("shows the cluster's usage-history coverage", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CostWaste />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("History: observed 12 of 840 hours")).toBeInTheDocument();
  });

  it("forecasts headroom against the streamed nodes' allocatable", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CostWaste />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Headroom forecast")).toBeInTheDocument();
    // n1 has 4 cores allocatable: (4000m - 3600m) / 200m per day = 2 days.
    expect(screen.getByText("reaches allocatable in ~2 days")).toBeInTheDocument();
  });

  it("shows the read-only node consolidation view; a single busy node can't be drained", () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CostWaste />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Node consolidation")).toBeInTheDocument();
    expect(screen.getByText(/No node can be drained right now/)).toBeInTheDocument();
    expect(screen.getByText(/no room elsewhere \(a\/p1\)/)).toBeInTheDocument();
  });

  it("shows the unusual-usage card next to the forecast, from the same history", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CostWaste />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Unusual usage")).toBeInTheDocument();
  });
});
