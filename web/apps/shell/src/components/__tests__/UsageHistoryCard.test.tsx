import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UsageHistoryCard } from "../UsageHistoryCard";
import { historyApi } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  historyApi: {
    status: vi.fn(async (cluster: string) => ({
      cluster,
      available: true,
      recording: cluster !== "prod",
      path: "/home/me/.config/kubebay/history",
      retentionDays: 35,
      coverage: cluster === "kind-dev" ? { label: "observed 09–18 local, weekdays only", observedHours: 40, expectedHours: 840 } : undefined,
    })),
    setRecording: vi.fn(async () => ({})),
    erase: vi.fn(async () => ({ erased: 1 })),
  },
}));

function renderCard(clusters: Record<string, boolean>) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UsageHistoryCard clusters={clusters} />
    </QueryClientProvider>,
  );
}

describe("UsageHistoryCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("explains what is recorded, and that nothing is until you connect", () => {
    renderCard({});
    expect(screen.getByText(/records hourly namespace usage for clusters you connect to, only while the app is open, for 35 days/i)).toBeInTheDocument();
    expect(screen.getByText(/connect to a cluster to start/i)).toBeInTheDocument();
  });

  it("lists each consented cluster with its coverage and the storage path", async () => {
    renderCard({ "kind-dev": true, prod: false });
    expect(await screen.findByText("observed 09–18 local, weekdays only")).toBeInTheDocument();
    expect(screen.getByText("kind-dev")).toBeInTheDocument();
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(await screen.findByText("/home/me/.config/kubebay/history")).toBeInTheDocument();
  });

  it("stops and resumes recording per cluster", async () => {
    renderCard({ "kind-dev": true, prod: false });
    fireEvent.click(await screen.findByRole("button", { name: "Stop recording kind-dev" }));
    await waitFor(() => expect(historyApi.setRecording).toHaveBeenCalledWith("kind-dev", false));
    fireEvent.click(screen.getByRole("button", { name: "Resume recording prod" }));
    await waitFor(() => expect(historyApi.setRecording).toHaveBeenCalledWith("prod", true));
  });

  it("clears a cluster's history only after confirming", async () => {
    renderCard({ "kind-dev": true });
    const clear = await screen.findByRole("button", { name: "Clear" });
    fireEvent.click(clear);
    expect(historyApi.erase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete history/i }));
    await waitFor(() => expect(historyApi.erase).toHaveBeenCalledWith("kind-dev"));
  });
});
