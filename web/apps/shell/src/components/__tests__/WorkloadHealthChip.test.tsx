import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkloadHealthChip } from "../WorkloadHealthChip";
import * as api from "../../lib/api";

// The 7-day chip in the workload drawer: is this workload's trouble chronic?
// Only from recorded history, with recorded hours as the denominator, and only
// once there are at least 24 of them. Otherwise it renders nothing.

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  historyApi: { status: vi.fn(), health: vi.fn() },
}));

const deploy = { kind: "Deployment", metadata: { name: "api", namespace: "shop", creationTimestamp: "2026-09-01T00:00:00Z" } };
const recording = { cluster: "c1", available: true, recording: true } as api.HistoryStatus;

function renderIt(obj: Record<string, unknown> = deploy) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WorkloadHealthChip cluster="c1" obj={obj} />
    </QueryClientProvider>,
  );
}

describe("WorkloadHealthChip", () => {
  beforeEach(() => {
    vi.mocked(api.historyApi.status).mockReset().mockResolvedValue(recording);
    vi.mocked(api.historyApi.health).mockReset();
  });

  it("says how many recorded hours and days it was broken in", async () => {
    vi.mocked(api.historyApi.health).mockResolvedValue({ recordedHours: 131, brokenHours: 9, recordedDays: 6, brokenDays: 4 });
    renderIt();
    expect(await screen.findByText("Broken in 9 of 131 recorded hours, on 4 of 6 recorded days")).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(api.historyApi.health).toHaveBeenCalledWith("c1", "shop", "Deployment", "api", "2026-09-01T00:00:00Z");
  });

  it("says when it had no trouble", async () => {
    vi.mocked(api.historyApi.health).mockResolvedValue({ recordedHours: 131, brokenHours: 0, recordedDays: 6, brokenDays: 0 });
    renderIt();
    expect(await screen.findByText("No trouble in 131 recorded hours")).toBeInTheDocument();
  });

  it("renders nothing with under 24 recorded hours, when not recording, or when history has nothing", async () => {
    vi.mocked(api.historyApi.health).mockResolvedValue({ recordedHours: 23, brokenHours: 3, recordedDays: 1, brokenDays: 1 });
    const a = renderIt();
    await waitFor(() => expect(api.historyApi.health).toHaveBeenCalled());
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();

    vi.mocked(api.historyApi.health).mockClear();
    vi.mocked(api.historyApi.status).mockResolvedValue({ ...recording, recording: false });
    const b = renderIt();
    await waitFor(() => expect(api.historyApi.status).toHaveBeenCalled());
    expect(api.historyApi.health).not.toHaveBeenCalled();
    expect(b.container).toBeEmptyDOMElement();
    b.unmount();

    vi.mocked(api.historyApi.status).mockResolvedValue(recording);
    vi.mocked(api.historyApi.health).mockRejectedValue(new Error("no history recorded for this cluster"));
    const c = renderIt();
    await waitFor(() => expect(api.historyApi.health).toHaveBeenCalled());
    expect(c.container).toBeEmptyDOMElement();
  });
});
