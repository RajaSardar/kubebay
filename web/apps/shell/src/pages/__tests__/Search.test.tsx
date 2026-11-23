import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Search from "../Search";
import { connectCluster } from "../../lib/clusterConnections";
import { useClusterStore } from "../../lib/cluster-store";
import { useClusterMeta } from "../../lib/cluster-meta-store";
import { api, searchApi, type ClusterInfo, type ColdSearchResponse, type SearchResponse } from "../../lib/api";
import type { SearchObject } from "../../lib/paletteSearch";

let objects: SearchObject[] = [];
vi.mock("../../lib/usePaletteObjects", () => ({ usePaletteObjects: () => objects }));
vi.mock("../../lib/clusterConnections", () => ({
  getConnectedClusters: vi.fn(() => new Set(["prod"])),
  isClusterSynced: vi.fn(() => true),
  subscribeConnections: () => () => {},
  connectCluster: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, clusters: vi.fn() },
    searchApi: { search: vi.fn(), clusters: vi.fn() },
    historyApi: { ...actual.historyApi, enroll: vi.fn(async () => {}) },
  };
});

const info = (id: string, status: ClusterInfo["status"] = "reachable"): ClusterInfo => ({ id, context: id, server: "https://x", status });
const remote = (over: Partial<SearchResponse> = {}): SearchResponse => ({ groups: [], filter: "", indexed: 0, pending: [], onDemand: [], truncated: [], denied: [], ...over });
const cold = (over: Partial<ColdSearchResponse> = {}): ColdSearchResponse => ({ hits: [], total: 0, capped: false, kinds: ["Pods"], clusters: [], ...over });

function Where() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname + l.search}</div>;
}

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/search" element={<Search />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  objects = [
    { cluster: "prod", slug: "deployments", ns: "shop", name: "api" },
    { cluster: "prod", slug: "pods", ns: "shop", name: "web-1" },
  ];
  vi.mocked(api.clusters).mockReset().mockResolvedValue([{ ...info("prod"), connected: true }, info("stage"), info("eu"), info("broken", "misconfigured")]);
  vi.mocked(searchApi.search).mockReset().mockResolvedValue(remote());
  vi.mocked(searchApi.clusters).mockReset().mockResolvedValue(cold());
  vi.mocked(connectCluster).mockClear();
  useClusterStore.setState({ active: "prod" });
  useClusterMeta.setState({ meta: { eu: { alias: "Europe" } } });
});

describe("Search all clusters", () => {
  it("searches the connected clusters for the text in the address, showing cluster, kind, namespace and name", async () => {
    renderAt("/search?q=api");
    expect(screen.getByRole("heading", { name: /Search all clusters/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search all clusters" })).toHaveValue("api");
    const row = (await screen.findByText("api")).closest("tr")!;
    expect(row).toHaveTextContent("prod");
    expect(row).toHaveTextContent("Deployments");
    expect(row).toHaveTextContent("shop");
  });

  it("doesn't touch disconnected clusters until asked, then searches them without connecting", async () => {
    vi.mocked(searchApi.clusters).mockResolvedValue(
      cold({
        total: 1,
        hits: [{ cluster: "stage", slug: "deployments", kind: "Deployments", ns: "shop", name: "api-v2", score: 90 }],
        clusters: [
          { id: "stage", denied: [], truncated: [], hits: 1 },
          { id: "eu", error: "Pods: connection refused", denied: [], truncated: [], hits: 0 },
        ],
      }),
    );
    renderAt("/search?q=api");
    const ask = await screen.findByRole("button", { name: "Also search 2 disconnected clusters" });
    expect(screen.getByText("2 clusters that aren't connected weren't searched.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(searchApi.clusters).not.toHaveBeenCalled();

    fireEvent.click(ask);
    const row = (await screen.findByText("api-v2")).closest("tr")!;
    expect(row).toHaveTextContent("stage");
    expect(vi.mocked(searchApi.clusters).mock.calls[0]!.slice(0, 2)).toEqual([["stage", "eu"], "api"]);
    expect(screen.getByText("Europe: couldn't search it. Pods: connection refused")).toBeInTheDocument();
    expect(connectCluster).not.toHaveBeenCalled();
  });

  it("opens a result in its cluster, with its drawer", async () => {
    renderAt("/search?q=web");
    fireEvent.click(await screen.findByText("web-1"));
    await waitFor(() => expect(screen.getByTestId("at")).toHaveTextContent("/workloads?pod=shop%2Fweb-1"));
    expect(connectCluster).toHaveBeenCalledWith("prod");
  });

  it("says when nothing matches, and asks for words when the box is empty", async () => {
    renderAt("/search");
    expect(screen.getByText("Search every cluster at once.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search all clusters" }), { target: { value: "zzz" } });
    expect(await screen.findByText("Nothing matches “zzz”.")).toBeInTheDocument();
  });
});
