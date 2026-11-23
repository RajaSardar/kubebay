import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChartsTab } from "../HelmCharts";
import { helmApi, helmMarketApi, type HelmChartDetail, type HelmRelease } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  helmApi: { releases: vi.fn(), manifestText: vi.fn(), upgrade: vi.fn() },
  helmMarketApi: {
    repos: vi.fn(),
    charts: vi.fn(),
    chart: vi.fn(),
    chartValuesText: vi.fn(),
    updateRepos: vi.fn(),
    updateRepo: vi.fn(),
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
  },
}));
vi.mock("../../lib/monaco", () => ({
  default: ({ value }: { value?: string }) => <div data-testid="editor">{value}</div>,
  DiffEditor: ({ original, modified }: { original?: string; modified?: string }) => (
    <div data-testid="diff">
      <span data-testid="diff-original">{original}</span>
      <span data-testid="diff-modified">{modified}</span>
    </div>
  ),
}));

const release = (over: Partial<HelmRelease> = {}): HelmRelease => ({
  name: "cache",
  namespace: "shop",
  chart: "redis",
  chartVersion: "1.0.0",
  status: "deployed",
  revision: 3,
  ...over,
});
const detail: HelmChartDetail = {
  name: "redis",
  repo: "store",
  version: "3.0.0",
  versions: [{ version: "3.0.0" }, { version: "2.0.0" }, { version: "1.0.0" }],
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ChartsTab cluster="c1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  const recent = new Date(Date.now() - 5 * 60_000).toISOString();
  vi.mocked(helmMarketApi.repos).mockResolvedValue([
    { name: "store", url: "https://charts.example.com", updated: recent },
    { name: "fresh", url: "https://fresh.example.com" },
  ]);
  vi.mocked(helmMarketApi.charts).mockResolvedValue([{ name: "redis", version: "3.0.0", description: "", versions: 3 }]);
  vi.mocked(helmMarketApi.chart).mockResolvedValue(detail);
  vi.mocked(helmMarketApi.chartValuesText).mockImplementation(async (_c, _ref, v) => `replicas: ${v ?? "latest"}\n`);
  vi.mocked(helmApi.releases).mockResolvedValue({ releases: [release()], denied: [] });
});

describe("refreshing one repository", () => {
  it("shows when the selected repository's index was last updated", async () => {
    mount();
    expect(await screen.findByText("Index updated 5m ago")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("repository"), { target: { value: "fresh" } });
    expect(await screen.findByText("Index never fetched")).toBeInTheDocument();
  });

  it("re-fetches only that repository's index, then reloads the repo list and its charts", async () => {
    vi.mocked(helmMarketApi.updateRepo).mockResolvedValue({ store: "ok" });
    mount();
    await screen.findByText("redis");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(helmMarketApi.updateRepo).toHaveBeenCalledWith("c1", "store"));
    expect(helmMarketApi.updateRepos).not.toHaveBeenCalled();
    await waitFor(() => expect(helmMarketApi.repos).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(vi.mocked(helmMarketApi.charts).mock.calls.filter(([, r]) => r === "store").length).toBe(2));
  });

  it("shows why a refresh failed", async () => {
    vi.mocked(helmMarketApi.updateRepo).mockResolvedValue({ store: "error: not fetched: link-local address" });
    mount();
    await screen.findByText("redis");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/store: error: not fetched: link-local address/)).toBeInTheDocument();
  });
});

describe("comparing two versions' default values", () => {
  it("diffs the installed version's values.yaml against the newest", async () => {
    mount();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(await screen.findByRole("tab", { name: "Compare versions" }));
    await waitFor(() => expect(screen.getByTestId("diff-original")).toHaveTextContent("replicas: 1.0.0"));
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("replicas: 3.0.0");
    expect(helmMarketApi.chartValuesText).toHaveBeenCalledWith("c1", "store/redis", "1.0.0");
    expect(helmMarketApi.chartValuesText).toHaveBeenCalledWith("c1", "store/redis", "3.0.0");
    expect(screen.getByLabelText("From version")).toHaveValue("1.0.0");
    expect(screen.getByLabelText("To version")).toHaveValue("3.0.0");
  });

  it("fetches the versions picked", async () => {
    mount();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(await screen.findByRole("tab", { name: "Compare versions" }));
    fireEvent.change(await screen.findByLabelText("From version"), { target: { value: "2.0.0" } });
    await waitFor(() => expect(screen.getByTestId("diff-original")).toHaveTextContent("replicas: 2.0.0"));
    expect(helmMarketApi.chartValuesText).toHaveBeenCalledWith("c1", "store/redis", "2.0.0");
  });

  it("says when there is only one version to compare", async () => {
    vi.mocked(helmMarketApi.chart).mockResolvedValue({ ...detail, versions: [{ version: "3.0.0" }] });
    mount();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(await screen.findByRole("tab", { name: "Compare versions" }));
    expect(await screen.findByText(/only one version/)).toBeInTheDocument();
    expect(screen.queryByTestId("diff")).toBeNull();
  });
});

describe("installed releases and this repository", () => {
  it("flags a release whose chart version this repository's index does not list", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue({
      releases: [release(), release({ name: "other", namespace: "ops", chartVersion: "0.5.0" })],
      denied: [],
    });
    mount();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(await screen.findByRole("tab", { name: "About" }));
    const other = await screen.findByText(/other in ops/);
    expect(other).toHaveTextContent("version not in store's index");
    expect(screen.getByText(/cache in shop/)).not.toHaveTextContent("not in");
  });
});
