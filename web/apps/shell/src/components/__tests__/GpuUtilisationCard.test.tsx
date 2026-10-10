import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GpuUtilisationCard } from "../GpuUtilisationCard";
import { promApi, PromNotConfiguredError } from "../../lib/api";
import type { GpuPod } from "../../lib/gpuCapacity";

vi.mock("../../lib/api", async (orig) => {
  const real = await orig<typeof import("../../lib/api")>();
  return { ...real, promApi: { ...real.promApi, query: vi.fn() } };
});

const pods: GpuPod[] = [{ namespace: "ml", pod: "trainer-0", node: "g1", resource: "nvidia.com/gpu", count: 1 }];
const labels = { exported_namespace: "ml", exported_pod: "trainer-0", UUID: "GPU-1" };

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GpuUtilisationCard cluster="c1" pods={pods} />
    </QueryClientProvider>,
  );
}

describe("GpuUtilisationCard", () => {
  beforeEach(() => {
    vi.mocked(promApi.query).mockReset();
  });

  it("shows each claimed GPU's utilisation and flags an underused one", async () => {
    const value: Record<string, number> = {
      "avg_over_time(DCGM_FI_DEV_GPU_UTIL[24h:5m])": 3,
      "max_over_time(DCGM_FI_DEV_GPU_UTIL[24h:5m])": 12,
      "count_over_time(DCGM_FI_DEV_GPU_UTIL[24h:5m])": 288,
      "max_over_time(DCGM_FI_DEV_FB_USED[24h:5m])": 2048,
      "DCGM_FI_DEV_FB_USED + DCGM_FI_DEV_FB_FREE": 40960,
    };
    vi.mocked(promApi.query).mockImplementation(async ({ query }) =>
      value[query] === undefined ? [] : [{ metric: labels, value: [0, String(value[query])] }],
    );
    renderCard();
    expect(await screen.findByText("underused")).toBeInTheDocument();
    expect(screen.getByText("trainer-0")).toBeInTheDocument();
    expect(screen.getByText("3%")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("2.0 / 40.0 GiB")).toBeInTheDocument();
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(promApi.query).toHaveBeenCalledWith({ cluster: "c1", query: "avg_over_time(DCGM_FI_DEV_GPU_UTIL[24h:5m])" });
  });

  it("says Prometheus isn't set up when it isn't", async () => {
    vi.mocked(promApi.query).mockRejectedValue(new PromNotConfiguredError("prometheus not configured for c1"));
    renderCard();
    expect(await screen.findByText(/Set a Prometheus URL for this cluster in Settings/)).toBeInTheDocument();
  });

  it("says when this Prometheus has no DCGM metrics at all", async () => {
    vi.mocked(promApi.query).mockResolvedValue([]);
    renderCard();
    expect(await screen.findByText(/No DCGM exporter metrics/)).toBeInTheDocument();
  });

  it("shows a failed query", async () => {
    vi.mocked(promApi.query).mockRejectedValue(new Error("prometheus unreachable"));
    renderCard();
    expect(await screen.findByText(/prometheus unreachable/)).toBeInTheDocument();
  });
});
