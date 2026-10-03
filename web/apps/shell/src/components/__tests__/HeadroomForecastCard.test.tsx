import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeadroomForecastCard } from "../HeadroomForecastCard";
import { historyApi, type HistorySeries } from "../../lib/api";
import type { HistoryPoint } from "../../lib/headroomForecast";

vi.mock("../../lib/api", () => ({ historyApi: { series: vi.fn() } }));

function pt(day: number, h: number, vals: Partial<HistoryPoint>): HistoryPoint {
  return {
    t: new Date(2026, 8, day, h).toISOString(),
    n: 60, wellSampled: true,
    cpuMean: null, cpuMax: null, memMean: null, memMax: null, reqCpuMillis: null, reqMemBytes: null,
    ...vals,
  };
}

const coverage = {
  retentionDays: 35, expectedHours: 840, observedHours: 25, wellSampledHours: 25, distinctDays: 5, longestGapHours: 14,
  first: null, hourOfDayObserved: [], weekendObserved: false, label: "observed 09–13 local, weekdays only",
};

function renderCard(points: HistoryPoint[]) {
  vi.mocked(historyApi.series).mockResolvedValue({ ns: "", source: "local", points, coverage } as HistorySeries);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HeadroomForecastCard cluster="kind-dev" capacity={{ cpuMillis: 4000, memBytes: 8 * 1024 ** 3 }} />
    </QueryClientProvider>,
  );
}

describe("HeadroomForecastCard", () => {
  beforeEach(() => vi.mocked(historyApi.series).mockReset());

  it("projects a rising request trend to allocatable, labelled as observed-hours only", async () => {
    const pts = [1, 2, 3, 4, 5].flatMap((d, i) => [9, 10, 11, 12].map((h) => pt(d, h, { reqCpuMillis: 2000 + i * 200 })));
    renderCard(pts);
    expect(await screen.findByText("CPU requests")).toBeInTheDocument();
    expect(screen.getByText("reaches allocatable in ~6 days")).toBeInTheDocument();
    expect(screen.getByText("daily peak during observed hours")).toBeInTheDocument();
    expect(screen.getByText("observed 09–13 local, weekdays only")).toBeInTheDocument();
  });

  it("says how many more days the forecast needs instead of hiding it", async () => {
    const pts = [1, 2].flatMap((d) => [9, 10, 11, 12].map((h) => pt(d, h, { reqCpuMillis: 1000 })));
    renderCard(pts);
    expect(await screen.findByText(/needs 5 days with at least 4 well-sampled hours each/i)).toBeInTheDocument();
    expect(screen.getByText(/2 so far/)).toBeInTheDocument();
  });

  it("asks for history by explicit from/to within retention", async () => {
    renderCard([]);
    await screen.findByText(/needs 5 days/i);
    const [cluster, from, to] = vi.mocked(historyApi.series).mock.calls[0]!;
    expect(cluster).toBe("kind-dev");
    expect(new Date(to).getTime() - new Date(from).getTime()).toBeLessThanOrEqual(35 * 86_400_000);
  });
});
