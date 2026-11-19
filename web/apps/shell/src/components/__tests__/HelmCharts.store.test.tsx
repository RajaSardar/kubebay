import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChartsTab } from "../HelmCharts";
import { helmApi, helmMarketApi, type HelmChartDetail, type HelmChartEntry, type HelmRelease } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  helmApi: { releases: vi.fn(), manifestText: vi.fn(), upgrade: vi.fn() },
  helmMarketApi: {
    repos: vi.fn(),
    charts: vi.fn(),
    chart: vi.fn(),
    chartValuesText: vi.fn(),
    updateRepos: vi.fn(),
    addRepo: vi.fn(),
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

const entry = (name: string, over: Partial<HelmChartEntry> = {}): HelmChartEntry => ({
  name,
  description: `${name} chart`,
  version: "2.0.0",
  versions: 2,
  ...over,
});
const release = (name: string, namespace: string, chart: string): HelmRelease => ({
  name,
  namespace,
  chart,
  chartVersion: "1.0.0",
  status: "deployed",
  revision: 3,
});
const detail: HelmChartDetail = {
  name: "redis",
  repo: "store",
  version: "2.0.0",
  appVersion: "7.2",
  description: "In-memory data store",
  home: "https://example.com/redis",
  keywords: ["cache"],
  sources: ["https://example.com/src"],
  maintainers: [{ name: "Ada Lovelace", email: "ada@example.com" }],
  readme: "# Redis\nRuns a cache.",
  versions: [
    { version: "2.0.0", appVersion: "7.2" },
    { version: "1.0.0", appVersion: "7.0", deprecated: true },
  ],
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
  vi.mocked(helmMarketApi.repos).mockResolvedValue([{ name: "store", url: "https://charts.example.com" }]);
  vi.mocked(helmMarketApi.charts).mockResolvedValue([
    entry("redis", { keywords: ["cache"] }),
    entry("nginx"),
    entry("legacy", { deprecated: true }),
  ]);
  vi.mocked(helmMarketApi.chart).mockResolvedValue(detail);
  vi.mocked(helmMarketApi.chartValuesText).mockResolvedValue("replicas: 1\n");
  vi.mocked(helmApi.releases).mockResolvedValue({ releases: [release("cache", "shop", "redis")], denied: [] });
});

describe("the chart store's cards", () => {
  it("marks a chart that a release of this cluster runs as installed", async () => {
    mount();
    await screen.findByText("nginx");
    await waitFor(() => expect(screen.getAllByText("Installed")).toHaveLength(1));
    expect(screen.getByText("Installed").closest(".fleet-card")).toHaveTextContent("redis");
  });

  it("finds a chart by its keywords", async () => {
    mount();
    await screen.findByText("nginx");
    fireEvent.change(screen.getByPlaceholderText("Search charts…"), { target: { value: "cache" } });
    expect(screen.queryByText("nginx")).toBeNull();
    expect(screen.getByText("redis")).toBeInTheDocument();
  });

  it("can show only installed charts", async () => {
    mount();
    await screen.findByText("nginx");
    await waitFor(() => expect(screen.getByLabelText("Installed only")).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Installed only"));
    expect(screen.queryByText("nginx")).toBeNull();
    expect(screen.getByText("redis")).toBeInTheDocument();
  });

  it("can hide deprecated charts, and says which are deprecated", async () => {
    mount();
    await screen.findByText("legacy");
    expect(screen.getByText("Deprecated")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Hide deprecated"));
    expect(screen.queryByText("legacy")).toBeNull();
  });
});

describe("a chart's page", () => {
  it("shows its maintainers and versions, and its README as Markdown", async () => {
    mount();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(await screen.findByRole("tab", { name: "About" }));
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/redis")).toBeInTheDocument();
    expect(helmMarketApi.chart).toHaveBeenCalledWith("c1", "store", "redis", undefined);

    fireEvent.click(screen.getByRole("tab", { name: "README" }));
    // Rendered as Markdown, built from elements, never from the README's own HTML.
    expect(await screen.findByText(/Runs a cache\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Redis" })).toBeInTheDocument();
  });

  it("asks for the version picked", async () => {
    mount();
    fireEvent.click(await screen.findByText("redis"));
    const picker = await screen.findByLabelText("version");
    await waitFor(() => expect(picker.querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(picker, { target: { value: "1.0.0" } });
    await waitFor(() => expect(helmMarketApi.chart).toHaveBeenCalledWith("c1", "store", "redis", "1.0.0"));
  });

  it("starts an installed chart's form from its release, and offers Upgrade", async () => {
    mount();
    fireEvent.click(await screen.findByText("redis"));
    await waitFor(() => expect(screen.getByPlaceholderText("release name")).toHaveValue("cache"));
    expect(screen.getByPlaceholderText("namespace")).toHaveValue("shop");
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument();
  });

  it("offers Install for a chart nothing runs", async () => {
    mount();
    fireEvent.click(await screen.findByText("nginx"));
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });
});

describe("applying", () => {
  it("upgrades the running release with the version picked, no dry run", async () => {
    vi.mocked(helmApi.upgrade).mockResolvedValue(release("cache", "shop", "redis"));
    mount();
    fireEvent.click(await screen.findByText("redis"));
    await waitFor(() => expect(screen.getByPlaceholderText("release name")).toHaveValue("cache"));
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    await waitFor(() => expect(helmApi.upgrade).toHaveBeenCalled());
    const body = vi.mocked(helmApi.upgrade).mock.calls[0]![0];
    expect(body).toMatchObject({ name: "cache", ns: "shop", chartRef: "store/redis" });
    expect(body.dryRun).toBeUndefined();
  });

  it("warns when the name is a release of another chart", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue({ releases: [release("web", "default", "apache")], denied: [] });
    mount();
    fireEvent.click(await screen.findByText("nginx"));
    fireEvent.change(await screen.findByPlaceholderText("release name"), { target: { value: "web" } });
    expect(await screen.findByText(/runs the chart apache/)).toBeInTheDocument();
  });
});

describe("Preview", () => {
  it("diffs the render against the running release's manifest before an upgrade", async () => {
    vi.mocked(helmApi.manifestText).mockResolvedValue("kind: Deployment\nreplicas: 1\n");
    vi.mocked(helmApi.upgrade).mockResolvedValue({ ...release("cache", "shop", "redis"), manifest: "kind: Deployment\nreplicas: 3\n" });
    mount();
    fireEvent.click(await screen.findByText("redis"));
    await waitFor(() => expect(screen.getByPlaceholderText("release name")).toHaveValue("cache"));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByTestId("diff")).toBeInTheDocument();
    expect(screen.getByTestId("diff-original")).toHaveTextContent("replicas: 1");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("replicas: 3");
    expect(helmApi.manifestText).toHaveBeenCalledWith("c1", "shop", "cache");
    expect(helmApi.upgrade).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, name: "cache", ns: "shop", chartRef: "store/redis" }));
  });

  it("shows a new install's rendered manifest, and never applies anything", async () => {
    vi.mocked(helmApi.upgrade).mockResolvedValue({ ...release("nginx", "default", "nginx"), manifest: "kind: Service\n" });
    mount();
    fireEvent.click(await screen.findByText("nginx"));
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByText(/kind: Service/)).toBeInTheDocument());
    expect(helmApi.manifestText).not.toHaveBeenCalled();
    expect(helmApi.upgrade).toHaveBeenCalledTimes(1);
    expect(vi.mocked(helmApi.upgrade).mock.calls[0]![0]).toMatchObject({ dryRun: true });
  });

  it("says why a preview failed", async () => {
    vi.mocked(helmApi.upgrade).mockRejectedValue(new Error("install: values don't meet the schema"));
    mount();
    fireEvent.click(await screen.findByText("nginx"));
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    expect(await screen.findByText(/values don't meet the schema/)).toBeInTheDocument();
  });
});
