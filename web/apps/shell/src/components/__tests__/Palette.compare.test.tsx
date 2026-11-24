import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Palette } from "../Palette";
import { useClusterStore } from "../../lib/cluster-store";
import { useCompare } from "../../lib/compare-store";
import { api } from "../../lib/api";

vi.mock("../../lib/clusterConnections", () => ({
  getConnectedClusters: vi.fn(() => new Set(["prod"])),
  getClusterRows: vi.fn((_c: string, gvr: string) =>
    gvr === "apps/v1/deployments" ? [{ metadata: { name: "web", namespace: "shop" } }] : [],
  ),
  isClusterSynced: vi.fn(() => true),
  subscribeConnections: () => () => {},
  connectCluster: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, clusters: vi.fn(), pfList: vi.fn(async () => []) },
    searchApi: { ...actual.searchApi, search: vi.fn(async () => ({ groups: [], filter: "", indexed: 0, pending: [], onDemand: [], truncated: [], denied: [] })) },
    historyApi: { ...actual.historyApi, enroll: vi.fn(async () => {}) },
  };
});

const type = (v: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: v } });
const closed = vi.fn();

function renderPalette() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Palette open onClose={closed} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  closed.mockClear();
  useCompare.getState().close();
  useClusterStore.setState({ active: "prod" });
  vi.mocked(api.clusters).mockResolvedValue([]);
});

describe("Palette: compare", () => {
  it("offers Compare resources… for the word compare, and opens an empty dialog", () => {
    renderPalette();
    type("compare");
    fireEvent.click(screen.getByRole("button", { name: "Compare resources…" }));
    expect(useCompare.getState()).toMatchObject({ open: true, left: null, right: null });
    expect(closed).toHaveBeenCalled();
  });

  it("does not crowd ordinary searches with a Compare row", () => {
    renderPalette();
    type("deploy web");
    expect(screen.queryByRole("button", { name: /Compare/ })).toBeNull();
  });
});
