import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Fleet from "../Fleet";
import { api } from "../../lib/api";

const setClusterMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, clusters: vi.fn() } };
});

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "", setCluster: setClusterMock, list: [], isLoading: false }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../../lib/useFleetWaste", () => ({
  useFleetWaste: () => ({
    summary: { totalWastedCpuMillis: 0, totalWastedMemBytes: 0, perCluster: [] },
    showback: [
      {
        ns: "payments", clusters: ["kind-a"], workloads: 1,
        requestedCpuMillis: 1000, requestedMemBytes: 0, p95CpuMillis: 100, p95MemBytes: 0, wastedCpuMillis: 900, wastedMemBytes: 0,
      },
    ],
    loading: false,
  }),
}));

vi.mock("../../components/FleetClusterHealthCard", () => ({
  FleetClusterHealthCard: ({ cluster, onOpen }: { cluster: string; onOpen: (id: string) => void }) => (
    <div data-testid={`health-card-${cluster}`} onClick={() => onOpen(cluster)}>
      {cluster}
    </div>
  ),
}));

function renderFleet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Fleet />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Fleet", () => {
  it("shows an empty state when no clusters are configured", async () => {
    vi.mocked(api.clusters).mockResolvedValue([]);
    renderFleet();
    expect(await screen.findByText(/no clusters configured/i)).toBeTruthy();
  });

  it("separates non-connected clusters into a 'needs attention' section", async () => {
    vi.mocked(api.clusters).mockResolvedValue([
      { id: "kind-a", context: "kind-a", server: "https://a", status: "connected" },
      { id: "kind-b", context: "kind-b", server: "https://b", status: "unreachable", error: "dial tcp: timeout" },
    ]);
    renderFleet();

    expect(await screen.findByText(/needs attention/i)).toBeTruthy();
    expect(screen.getByText("kind-b")).toBeTruthy();
    expect(screen.getByText(/dial tcp: timeout/)).toBeTruthy();
    expect(screen.getByTestId("health-card-kind-a")).toBeTruthy();
  });

  it("jumps into a cluster's Workloads Overview when its health card is opened", async () => {
    vi.mocked(api.clusters).mockResolvedValue([{ id: "kind-a", context: "kind-a", server: "https://a", status: "connected" }]);
    renderFleet();

    fireEvent.click(await screen.findByTestId("health-card-kind-a"));
    await waitFor(() => expect(setClusterMock).toHaveBeenCalledWith("kind-a"));
    expect(navigateMock).toHaveBeenCalledWith("/workloads");
  });

  it("shows namespace showback across the fleet", async () => {
    vi.mocked(api.clusters).mockResolvedValue([{ id: "kind-a", context: "kind-a", server: "https://a", status: "connected" }]);
    renderFleet();
    expect(await screen.findByText(/Showback by namespace/)).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });
});
