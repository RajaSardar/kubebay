import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChangeTimelineCard } from "../ChangeTimelineCard";
import { timelineApi } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  timelineApi: { status: vi.fn(), setRetention: vi.fn(), clear: vi.fn() },
}));

const st = { enabled: true, retentionDays: 7, rows: 1234, dbBytes: 5 << 20, capBytes: 100 << 20, evicted: 0, dropped: 0 };

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChangeTimelineCard />
    </QueryClientProvider>,
  );
}

describe("ChangeTimelineCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(timelineApi.status).mockResolvedValue(st);
    vi.mocked(timelineApi.setRetention).mockResolvedValue(st);
  });

  it("shows retention, size and offers Off to 30 days", async () => {
    renderCard();
    const sel = (await screen.findByLabelText("Keep changes for")) as HTMLSelectElement;
    expect(sel.value).toBe("7");
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["0", "1", "3", "7", "14", "30"]);
    expect(screen.getByText(/1,234 changes, 5.0 MB of 100.0 MB/)).toBeInTheDocument();
  });

  it("changes the retention through the engine", async () => {
    renderCard();
    fireEvent.change(await screen.findByLabelText("Keep changes for"), { target: { value: "30" } });
    await waitFor(() => expect(timelineApi.setRetention).toHaveBeenCalledWith(30));
  });

  it("shows the engine's reason instead of controls on a shared engine", async () => {
    vi.mocked(timelineApi.status).mockRejectedValue(new Error("The change timeline is not kept for in-cluster deployments."));
    renderCard();
    expect(await screen.findByText(/not kept for in-cluster/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Keep changes for")).toBeNull();
  });
});
