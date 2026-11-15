import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Ports from "../Ports";
import { api } from "../../lib/api";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, pfList: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Ports />
    </QueryClientProvider>,
  );
}

describe("Ports", () => {
  it("shows the loader, not 'No active tunnels', while the list loads", () => {
    vi.mocked(api.pfList).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.queryByText("No active tunnels.")).toBeNull();
    expect(screen.getByRole("table").querySelector("caption.kb-table-loading")).toHaveTextContent("Loading port forwards…");
  });

  it("says there are no tunnels once loaded empty", async () => {
    vi.mocked(api.pfList).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No active tunnels.")).toBeInTheDocument();
  });
});
