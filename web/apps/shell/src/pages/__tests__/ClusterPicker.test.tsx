import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ClusterPicker from "../ClusterPicker";
import { api } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, clusters: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClusterPicker />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ClusterPicker", () => {
  it("says a cluster is being checked before its first probe, not that it is disconnected", async () => {
    vi.mocked(api.clusters).mockResolvedValue([
      { id: "kind-dev", context: "kind-dev", server: "https://127.0.0.1:6443", status: "checking", connected: false },
    ]);
    renderPage();
    expect(await screen.findByText("Checking…")).toBeInTheDocument();
    expect(screen.queryByText("Disconnected")).toBeNull();
  });
});
