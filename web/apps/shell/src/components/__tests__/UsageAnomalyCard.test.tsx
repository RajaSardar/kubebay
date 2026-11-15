import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UsageAnomalyCard } from "../UsageAnomalyCard";
import { historyApi, type HistorySeries } from "../../lib/api";
import type { HistoryPoint } from "../../lib/headroomForecast";

vi.mock("../../lib/api", () => ({ historyApi: { series: vi.fn() } }));

function pt(day: number, h: number, vals: Partial<HistoryPoint>): HistoryPoint {
  return {
    t: new Date(2026, 8, day, h).toISOString(), n: 60, wellSampled: true,
    cpuMean: null, cpuMax: null, memMean: null, memMax: null, reqCpuMillis: null, reqMemBytes: null,
    ...vals,
  };
}

// Prior weekdays at 10:00 with CPU ~1 core; Fri 18 Sep at 10:00 spikes to 3.1 cores.
const baseline = [7, 8, 9, 10, 11, 14, 15, 16, 17].map((d) => pt(d, 10, { cpuMean: 1000 }));

function renderCard(points: HistoryPoint[], now = new Date(2026, 8, 18, 12)) {
  vi.mocked(historyApi.series).mockResolvedValue({ ns: "", source: "local", points, coverage: { label: "observed 09–18 local, weekdays only" } } as HistorySeries);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UsageAnomalyCard cluster="kind-dev" now={now} />
    </QueryClientProvider>,
  );
}

describe("UsageAnomalyCard", () => {
  beforeEach(() => {
    vi.mocked(historyApi.series).mockReset();
  });

  it("lists an unusual hour with its ratio to the usual value for that hour", async () => {
    renderCard([...baseline, pt(18, 10, { cpuMean: 3100 })]);
    expect(await screen.findByText("Unusual usage")).toBeInTheDocument();
    expect(screen.getByText("CPU usage")).toBeInTheDocument();
    expect(screen.getByText("3.1× usual")).toBeInTheDocument();
    expect(screen.getByText(/usual 1\.00/)).toBeInTheDocument();
    expect(screen.getByText(/same hour on 9 earlier weekdays/)).toBeInTheDocument();
  });

  it("says plainly when nothing in the last 24 hours stands out, and what it compared against", async () => {
    renderCard([...baseline, pt(18, 10, { cpuMean: 1010 })]);
    expect(await screen.findByText(/Nothing unusual in the last 24 hours/)).toBeInTheDocument();
    expect(screen.getByText(/at least 5 earlier days/)).toBeInTheDocument();
  });

  it("renders nothing without recorded history", async () => {
    vi.mocked(historyApi.series).mockRejectedValue(new Error("no history recorded for this cluster"));
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UsageAnomalyCard cluster="kind-dev" />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
