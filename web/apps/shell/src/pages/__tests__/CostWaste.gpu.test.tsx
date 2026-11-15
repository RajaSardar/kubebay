import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CostWaste from "../CostWaste";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

const node = { metadata: { name: "g1" }, status: { allocatable: { cpu: "8", memory: "32Gi", "nvidia.com/gpu": "4" } } };
const pod = {
  metadata: { name: "train", namespace: "ml" },
  spec: { nodeName: "g1", containers: [{ name: "c", resources: { requests: { cpu: "1" }, limits: { "nvidia.com/gpu": "1" } } }] },
  status: { phase: "Running" },
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
  promApi: { query: vi.fn(async () => []), queryRange: vi.fn() },
}));

describe("CostWaste GPU capacity", () => {
  it("shows unclaimed GPUs from the nodes and pods the page already streams", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CostWaste />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("3 of 4 nvidia.com/gpu unclaimed")).toBeInTheDocument();
  });

  it("adds the claimed GPUs' utilisation card when a pod claims an NVIDIA GPU", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CostWaste />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("GPU utilisation")).toBeInTheDocument();
  });
});
