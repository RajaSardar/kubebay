import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HistoryCoverageChip } from "../HistoryCoverageChip";
import { historyApi, type HistoryStatus } from "../../lib/api";

vi.mock("../../lib/api", () => ({ historyApi: { status: vi.fn() } }));

function renderChip(status: Partial<HistoryStatus>) {
  vi.mocked(historyApi.status).mockResolvedValue({ cluster: "kind-dev", available: true, recording: true, ...status } as HistoryStatus);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <HistoryCoverageChip cluster="kind-dev" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const coverage = {
  retentionDays: 35, expectedHours: 840, observedHours: 41, wellSampledHours: 38, distinctDays: 5, longestGapHours: 14,
  first: null, hourOfDayObserved: [], weekendObserved: false, label: "observed 09–18 local, weekdays only",
};

describe("HistoryCoverageChip", () => {
  beforeEach(() => vi.mocked(historyApi.status).mockReset());

  it("shows how much of the retention window is observed, with the engine's label", async () => {
    renderChip({ coverage });
    expect(await screen.findByText("History: observed 41 of 840 hours")).toBeInTheDocument();
    expect(screen.getByText("observed 09–18 local, weekdays only")).toBeInTheDocument();
  });

  it("says when recording is stopped for this cluster, linking to Settings", async () => {
    renderChip({ recording: false, coverage });
    expect(await screen.findByText("History: stopped")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
  });

  it("says when recording has started but nothing is stored yet", async () => {
    renderChip({});
    expect(await screen.findByText("History: recording, no hours yet")).toBeInTheDocument();
  });

  it("shows the reason when history is unavailable on this engine", async () => {
    renderChip({ available: false, recording: false, reason: "usage history is not recorded for in-cluster deployments" });
    expect(await screen.findByText(/not recorded for in-cluster deployments/)).toBeInTheDocument();
  });
});
