import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ClusterPicker from "../ClusterPicker";
import { api, historyApi, type ClusterInfo, type HistorySummary } from "../../lib/api";
import * as channel from "../../lib/clusterChannel";
import { useClusterStore } from "../../lib/cluster-store";
import { useClusterMeta } from "../../lib/cluster-meta-store";
import * as conns from "../../lib/clusterConnections";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, clusters: vi.fn(), disconnectCluster: vi.fn() }, historyApi: { ...actual.historyApi, enroll: vi.fn(() => Promise.resolve()), summary: vi.fn() } };
});

vi.mock("../../lib/clusterChannel", () => ({ announceDisconnect: vi.fn(), onRemoteDisconnect: vi.fn(() => () => {}) }));

const noHistory: HistorySummary = { available: true, bucketHours: 4, clusters: {} };

const summaries: Record<string, conns.ClusterSummary> = {};
vi.mock("../../lib/clusterConnections", () => ({
  connectCluster: vi.fn(),
  disconnectCluster: vi.fn(),
  subscribeConnections: () => () => {},
  getConnectionsVersion: () => 0,
  connectionError: () => "",
  clusterSummary: (id: string) => summaries[id] ?? null,
}));

const dev: ClusterInfo = { id: "kind-dev", context: "kind-dev", server: "https://127.0.0.1:6443", status: "reachable", version: "v1.31.0", connected: true };
const stage: ClusterInfo = { id: "stage", context: "arn:aws:eks:eu-west-1:123:cluster/stage", server: "https://ABC.eks.amazonaws.com", status: "reachable", version: "v1.30.2" };
const down: ClusterInfo = { id: "lab", context: "lab", server: "https://10.0.0.9:6443", status: "unreachable", error: "dial tcp 10.0.0.9:6443: i/o timeout" };
const broken: ClusterInfo = { id: "broken", context: "broken", server: "", status: "misconfigured", error: "exec plugin: aws not found" };
const fresh: ClusterInfo = { id: "new", context: "new", server: "https://x", status: "checking" };

function renderPage(list: ClusterInfo[] = [dev, stage, down, broken]) {
  vi.mocked(api.clusters).mockResolvedValue(list);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClusterPicker />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowOf(name: string) {
  return screen.getByText(name, { selector: "[data-cluster-name]" }).closest("tr")!;
}

function openMenu(name: string) {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: `Actions for ${name}` }));
  return screen.getByRole("menu");
}

beforeEach(() => {
  navigateMock.mockReset();
  vi.mocked(api.disconnectCluster).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(conns.connectCluster).mockReset();
  vi.mocked(conns.disconnectCluster).mockReset();
  vi.mocked(channel.announceDisconnect).mockReset();
  vi.mocked(historyApi.summary).mockReset().mockResolvedValue(noHistory);
  for (const k of Object.keys(summaries)) delete summaries[k];
  useClusterStore.setState({ active: "" });
  useClusterMeta.setState({ meta: {} });
});

describe("ClusterPicker", () => {
  it("says a cluster is being checked before its first probe, not that it is disconnected", async () => {
    renderPage([fresh]);
    expect(await screen.findByText("Checking…")).toBeInTheDocument();
    expect(screen.queryByText("Disconnected")).toBeNull();
  });

  it("summarises the fleet in the header", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: /^Clusters/ })).toBeInTheDocument();
    expect(await screen.findByText("1 connected · 2 reachable · 1 unreachable · 1 config error")).toBeInTheDocument();
  });

  it("separates the session (connected/active) from API reachability", async () => {
    useClusterStore.setState({ active: "kind-dev" });
    renderPage();
    await screen.findByText("kind-dev", { selector: "[data-cluster-name]" });
    expect(within(rowOf("kind-dev")).getByText("Active")).toBeInTheDocument();
    expect(within(rowOf("kind-dev")).getByText("Reachable")).toBeInTheDocument();
    expect(within(rowOf("stage")).queryByText("Connected")).toBeNull();
    expect(within(rowOf("stage")).getByText("Reachable")).toBeInTheDocument();
    expect(within(rowOf("lab")).getByText("Unreachable")).toBeInTheDocument();
    expect(within(rowOf("broken")).getByText("Config error")).toBeInTheDocument();
  });

  it("opens a cluster on click, with no drawer", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("stage", { selector: "[data-cluster-name]" }));
    expect(conns.connectCluster).toHaveBeenCalledWith("stage");
    expect(useClusterStore.getState().active).toBe("stage");
    expect(navigateMock).toHaveBeenCalledWith({ pathname: "/", search: "cluster=stage" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("View details")).toBeNull();
  });

  it("opens with Enter from the keyboard", async () => {
    renderPage();
    await screen.findByText("stage", { selector: "[data-cluster-name]" });
    fireEvent.keyDown(rowOf("stage"), { key: "Enter" });
    expect(navigateMock).toHaveBeenCalledWith({ pathname: "/", search: "cluster=stage" });
  });

  it("shows a config error in words instead of opening the cluster", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("broken", { selector: "[data-cluster-name]" }));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/exec plugin: aws not found/)).toBeInTheDocument();
  });

  it("offers Disconnect only for connected clusters and tears the session down", async () => {
    useClusterStore.setState({ active: "kind-dev" });
    renderPage();
    await screen.findByText("kind-dev", { selector: "[data-cluster-name]" });
    expect(within(openMenu("stage")).queryByRole("menuitem", { name: "Disconnect" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(within(openMenu("kind-dev")).getByRole("menuitem", { name: "Disconnect" }));
    await waitFor(() => expect(api.disconnectCluster).toHaveBeenCalledWith("kind-dev"));
    expect(conns.disconnectCluster).toHaveBeenCalledWith("kind-dev");
    expect(useClusterStore.getState().active).toBe("");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("disconnects everything at once", async () => {
    renderPage([dev, { ...stage, connected: true }]);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect all" }));
    await waitFor(() => expect(api.disconnectCluster).toHaveBeenCalledTimes(2));
  });

  it("shows pod health and node count for connected clusters only", async () => {
    summaries["kind-dev"] = { synced: true, pods: { healthy: 10, pending: 1, failing: 1, total: 12 }, nodes: 3 };
    renderPage();
    await screen.findByText("kind-dev", { selector: "[data-cluster-name]" });
    expect(within(rowOf("kind-dev")).getByRole("img", { name: "12 pods: 10 healthy, 1 pending, 1 failing" })).toBeInTheDocument();
    expect(within(rowOf("kind-dev")).getByText("3")).toBeInTheDocument();
    expect(within(rowOf("stage")).queryByRole("img", { name: /pods:/ })).toBeNull();
  });

  it("explains a failed cluster list instead of showing an empty table", async () => {
    vi.mocked(api.clusters).mockRejectedValue(new Error("engine unreachable"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ClusterPicker />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Couldn't load clusters/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("searches context and server, so an EKS ARN is findable", async () => {
    renderPage();
    await screen.findByText("stage", { selector: "[data-cluster-name]" });
    fireEvent.change(screen.getByLabelText("Search clusters"), { target: { value: "cluster/stage" } });
    expect(screen.queryByText("kind-dev", { selector: "[data-cluster-name]" })).toBeNull();
    expect(screen.getByText("stage", { selector: "[data-cluster-name]" })).toBeInTheDocument();
  });

  it("renames inline from the menu", async () => {
    renderPage();
    await screen.findByText("stage", { selector: "[data-cluster-name]" });
    fireEvent.click(within(openMenu("stage")).getByRole("menuitem", { name: "Rename…" }));
    const field = screen.getByLabelText("Display name for stage");
    fireEvent.change(field, { target: { value: "Staging EU" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useClusterMeta.getState().meta.stage?.alias).toBe("Staging EU");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("asks before removing a cluster from the list, and can show it again", async () => {
    renderPage();
    await screen.findByText("lab", { selector: "[data-cluster-name]" });
    fireEvent.click(within(openMenu("lab")).getByRole("menuitem", { name: "Remove from list…" }));
    const dialog = screen.getByRole("dialog", { name: "Remove lab?" });
    expect(within(dialog).getByRole("heading", { name: "Remove lab?" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Remove lab from the list/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(useClusterMeta.getState().meta.lab?.hidden).toBe(true);
    expect(screen.queryByText("lab", { selector: "[data-cluster-name]" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 hidden cluster/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show lab" }));
    expect(useClusterMeta.getState().meta.lab?.hidden).toBe(false);
  });

  it("copies the context name", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    await screen.findByText("stage", { selector: "[data-cluster-name]" });
    fireEvent.click(within(openMenu("stage")).getByRole("menuitem", { name: "Copy context name" }));
    expect(writeText).toHaveBeenCalledWith("arn:aws:eks:eu-west-1:123:cluster/stage");
  });

  it("draws a week of CPU peaks and the request headroom from recorded history", async () => {
    const pt = (cpuMax: number | null, reqCpuMillis: number | null) => ({ t: "2026-10-01T00:00:00Z", cpuMax, memMax: null, reqCpuMillis, reqMemBytes: 0 });
    vi.mocked(historyApi.summary).mockResolvedValue({
      available: true,
      bucketHours: 4,
      clusters: { stage: { points: [pt(1000, 2000), pt(null, null), pt(2000, 3000)], lastSample: "2026-10-01T00:00:00Z", allocCpuMillis: 4000, allocMemBytes: 8 * 2 ** 30, nodes: 3 } },
    });
    renderPage();
    const row = await screen.findByText("stage", { selector: "[data-cluster-name]" }).then(() => rowOf("stage"));
    expect(await within(row).findByRole("img", { name: "CPU peak over the last 7 days: 2 of 4 cores (50%)" })).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "Requests use 75% of allocatable CPU and 0% of memory on 3 nodes" })).toBeInTheDocument();
    expect(within(rowOf("lab")).queryByRole("img", { name: /CPU peak/ })).toBeNull();
  });

  it("still lists clusters when history is unavailable", async () => {
    vi.mocked(historyApi.summary).mockRejectedValue(new Error("404"));
    renderPage();
    expect(await screen.findByText("stage", { selector: "[data-cluster-name]" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /CPU peak/ })).toBeNull();
  });

  it("says when a cluster that isn't connected was last opened", async () => {
    useClusterMeta.setState({ meta: { stage: { lastUsed: Date.now() - 4 * 86_400_000 } } });
    renderPage();
    await screen.findByText("stage", { selector: "[data-cluster-name]" });
    expect(within(rowOf("stage")).getByText("Opened 4d ago")).toBeInTheDocument();
    expect(within(rowOf("lab")).queryByText(/Opened/)).toBeNull();
  });

  it("tells other windows when it disconnects a cluster", async () => {
    renderPage();
    await screen.findByText("kind-dev", { selector: "[data-cluster-name]" });
    fireEvent.click(within(openMenu("kind-dev")).getByRole("menuitem", { name: "Disconnect" }));
    await waitFor(() => expect(channel.announceDisconnect).toHaveBeenCalledWith("kind-dev"));
  });
});
