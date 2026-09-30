import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CostWaste from "../CostWaste";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

const node = { metadata: { name: "n1" }, status: { allocatable: { cpu: "4", memory: "16Gi" } } };
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
});
