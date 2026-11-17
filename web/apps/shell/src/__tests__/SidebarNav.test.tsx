import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const disconnectCluster = vi.fn();
const getObject = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: { ...actual.api, disconnectCluster: (id: string) => disconnectCluster(id), getObject: (...a: unknown[]) => getObject(...a) },
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
    getObject.mockReset().mockResolvedValue({});
    localStorage.clear();
    useClusterStore.setState({ active: "" });
  });

  it("puts Favorites below Tools and above Settings, each favourite a normal nav row", () => {
    localStorage.setItem("kb.favorites", JSON.stringify(["/workloads", "/helm"]));
    renderSidebar();
    const fav = screen.getByRole("button", { name: /Favorites/ });
    const tools = screen.getByText("Tools");
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(tools.compareDocumentPosition(fav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fav.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of ["Pods", "Helm"]) {
      const links = screen.getAllByRole("link", { name });
      const link = links[links.length - 1]!; // the favourite comes after the Tools/Navigate entries
      expect(link.className).toContain("nav-item");
      expect(link.className).not.toContain("sub");
    }
    const before = screen.getAllByRole("link", { name: "Helm" }).length;
    fireEvent.click(screen.getAllByRole("button", { name: "Remove from favorites" })[1]!);
    expect(screen.queryAllByRole("link", { name: "Helm" }).length).toBe(before - 1);
  });

  it("collapses Favorites and remembers it", () => {
    localStorage.setItem("kb.favorites", JSON.stringify(["/helm"]));
    const { unmount } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /Favorites/ }));
    expect(screen.getByRole("button", { name: /Favorites/ }).getAttribute("aria-expanded")).toBe("false");
    unmount();
    renderSidebar();
    expect(screen.getByRole("button", { name: /Favorites/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("lists a starred object, opens it on its cluster, and dims one that is gone", async () => {
    localStorage.setItem(
      "kb.favorites.objects",
      JSON.stringify([
        { cluster: "kind-dev", slug: "deployments", ns: "shop", name: "api", kind: "Deployment" },
        { cluster: "kind-dev", slug: "pods", ns: "shop", name: "gone-1", kind: "Pod" },
        { cluster: "kind-b", slug: "services", ns: "web", name: "front", kind: "Service" },
      ]),
    );
    getObject.mockImplementation(async (_c: string, _g: string, _n: string, name: string) => {
      if (name === "gone-1") throw new Error('pods "gone-1" not found');
      return {};
    });
    useClusterStore.setState({ active: "kind-dev" });
    renderSidebar();
    const gone = await screen.findByTestId("fav-dead-gone-1");
    expect(gone).toBeTruthy();
    expect(screen.getByText("gone-1")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove from favorites" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("link", { name: /front/ }));
    expect(useClusterStore.getState().active).toBe("kind-b");
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
