import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const disconnectCluster = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: { ...actual.api, disconnectCluster: (id: string) => disconnectCluster(id) },
    discoveryApi: { apis: async () => [] },
  };
});

const { Sidebar } = await import("../App");
const { useClusterStore } = await import("../lib/cluster-store");

const sidebar = { hidden: false, toggle: () => {}, hide: () => {}, show: () => {} } as never;

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["clusters"], [{ id: "kind-dev", status: "reachable" }]);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/workloads-overview"]}>
        <Sidebar onOpenPalette={() => {}} sidebar={sidebar} />
        <Routes>
          <Route path="/clusters" element={<div>cluster picker page</div>} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    disconnectCluster.mockReset().mockResolvedValue({ ok: true });
    localStorage.clear();
    useClusterStore.setState({ active: "" });
  });

  it("puts Favorites above Navigate, each favourite a normal nav row", () => {
    localStorage.setItem("kb.favorites", JSON.stringify(["/workloads", "/helm"]));
    renderSidebar();
    const fav = screen.getByText("Favorites");
    const navigate = screen.getByText("Navigate");
    expect(fav.compareDocumentPosition(navigate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of ["Pods", "Helm"]) {
      const link = screen.getAllByRole("link", { name })[0]!; // the favourite comes first in the DOM
      expect(link.className).toContain("nav-item");
      expect(link.className).not.toContain("sub");
    }
    const before = screen.getAllByRole("link", { name: "Helm" }).length;
    fireEvent.click(screen.getAllByRole("button", { name: "Remove from favorites" })[1]!);
    expect(screen.queryAllByRole("link", { name: "Helm" }).length).toBe(before - 1);
  });

  it("has no Disconnect button without an active cluster", () => {
    renderSidebar();
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it("disconnects the active cluster and goes to the picker", async () => {
    useClusterStore.setState({ active: "kind-dev" });
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    await waitFor(() => expect(disconnectCluster).toHaveBeenCalledWith("kind-dev"));
    expect(useClusterStore.getState().active).toBe("");
    expect(await screen.findByText("cluster picker page")).toBeInTheDocument();
  });
});
