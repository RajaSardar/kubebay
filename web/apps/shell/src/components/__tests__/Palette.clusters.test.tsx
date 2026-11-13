import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Palette } from "../Palette";
import { useClusterStore } from "../../lib/cluster-store";
import { useClusterMeta } from "../../lib/cluster-meta-store";
import { connectCluster } from "../../lib/clusterConnections";
import { api, type ClusterInfo } from "../../lib/api";

vi.mock("../../lib/clusterConnections", () => ({
  getConnectedClusters: vi.fn(() => new Set(["prod"])),
  getClusterRows: vi.fn(() => []),
  isClusterSynced: vi.fn(() => true),
  subscribeConnections: () => () => {},
  connectCluster: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, clusters: vi.fn(), pfList: vi.fn(async () => []) },
    historyApi: { ...actual.historyApi, enroll: vi.fn(async () => {}) },
  };
});

const info = (id: string, context: string, status: ClusterInfo["status"] = "reachable"): ClusterInfo => ({ id, context, server: "https://x", status });

function Where() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname + l.search}</div>;
}

async function renderPalette() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/pods"]}>
        <Palette open onClose={() => {}} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("Switch cluster");
}

const type = (v: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: v } });

beforeEach(() => {
  localStorage.clear();
  useClusterStore.setState({ active: "prod" });
  useClusterMeta.setState({ meta: { stage: { alias: "Staging", lastUsed: 500 } } });
  vi.mocked(connectCluster).mockClear();
  vi.mocked(api.clusters).mockResolvedValue([info("prod", "prod"), info("stage", "stage-ctx"), info("lab", "lab"), info("broken", "broken", "misconfigured")]);
});

describe("Palette: switch cluster", () => {
  it("offers your other clusters, most recent first, as soon as it opens", async () => {
    await renderPalette();
    const rows = screen.getAllByRole("button", { name: /^Switch to / }).map((b) => b.getAttribute("aria-label"));
    expect(rows[0]).toBe("Switch to Staging");
    expect(rows).not.toContain("Switch to prod");
  });

  it("switches the way the Clusters page does", async () => {
    await renderPalette();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Staging" }));
    expect(connectCluster).toHaveBeenCalledWith("stage");
    expect(useClusterStore.getState().active).toBe("stage");
    expect(screen.getByTestId("at").textContent).toBe("/?cluster=stage");
  });

  it("finds a cluster by typing part of its name, alias included", async () => {
    await renderPalette();
    type("stag");
    expect(screen.getByRole("button", { name: "Switch to Staging" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch to lab" })).toBeNull();
  });

  it("lists clusters first for 'switch' and a space, and Enter on the first one switches", async () => {
    await renderPalette();
    type("switch lab");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(connectCluster).toHaveBeenCalledWith("lab");
    expect(screen.getByTestId("at").textContent).toBe("/?cluster=lab");
  });

  it("sends a cluster that can't be opened to the Clusters page, which says why", async () => {
    await renderPalette();
    fireEvent.click(screen.getByRole("button", { name: "Switch to broken" }));
    expect(connectCluster).not.toHaveBeenCalled();
    expect(screen.getByTestId("at").textContent).toBe("/clusters");
  });

  it("shows no switch section when there is no other cluster", async () => {
    vi.mocked(api.clusters).mockResolvedValue([info("prod", "prod")]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Palette open onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.clusters).toHaveBeenCalled());
    expect(screen.queryByText("Switch cluster")).toBeNull();
  });
});
