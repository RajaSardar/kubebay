import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Ports from "../Ports";
import { api } from "../../lib/api";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, pfList: vi.fn(), pfStart: vi.fn() } };
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

  it("shows running and failed forwards with status and the failure reason", async () => {
    const base = { cluster: "c1", namespace: "ns", podPort: 80, startedAt: "2026-01-01T00:00:00Z" };
    vi.mocked(api.pfList).mockResolvedValue([
      { ...base, id: "a", pod: "api-0", localPort: 8080, status: "running" },
      { ...base, id: "b", pod: "web-0", localPort: 8081, status: "failed", error: "lost connection to pod" },
    ]);
    renderPage();
    expect(await screen.findByText("running")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText(/lost connection to pod/)).toBeInTheDocument();
  });

  it("surfaces the engine's port-conflict message when forwarding fails", async () => {
    vi.mocked(api.pfList).mockResolvedValue([]);
    vi.mocked(api.pfStart).mockRejectedValue(new Error("local port in use: port 8080 is already forwarded to ns/api-0:80 on cluster c1"));
    renderPage();
    await screen.findByText("No active tunnels.");
    fireEvent.change(screen.getByPlaceholderText("pod name"), { target: { value: "x" } });
    fireEvent.change(screen.getByPlaceholderText("pod port"), { target: { value: "80" } });
    fireEvent.change(screen.getByPlaceholderText("local (auto)"), { target: { value: "8080" } });
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(await screen.findByText(/already forwarded to ns\/api-0:80/)).toBeInTheDocument();
  });

  it("says there are no tunnels once loaded empty",async () => {
    vi.mocked(api.pfList).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No active tunnels.")).toBeInTheDocument();
  });
});
