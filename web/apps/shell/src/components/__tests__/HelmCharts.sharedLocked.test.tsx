import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChartsTab } from "../HelmCharts";
import { helmMarketApi, settingsApi } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
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
  settingsApi: { get: vi.fn(), save: vi.fn() },
}));
vi.mock("../../lib/monaco", () => ({ default: () => <div data-testid="editor" />, DiffEditor: () => <div /> }));

const REASON =
  "Helm repositories are read-only when OIDC is configured: every user's chart installs use them, so the operator sets them through the engine's --helm-repos flag or the Helm chart's helmRepos value.";

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
  vi.mocked(helmMarketApi.charts).mockResolvedValue([{ name: "redis", version: "1.0.0", description: "", versions: 1 }]);
});

describe("Helm store on a shared engine", () => {
  it("says why repositories are read-only and offers no Add or Remove repository", async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ extraKubeconfigs: [], sharedLocked: "locked", helmReposLocked: REASON });
    mount();
    expect(await screen.findByText(REASON)).toBeInTheDocument();
    await screen.findByText("redis");
    expect(screen.queryByRole("button", { name: "Add repository" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove repository" })).not.toBeInTheDocument();
    // Refreshing the operator's repositories still works.
    expect(screen.getByRole("button", { name: "Update indexes" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("keeps Add and Remove repository on the desktop", async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ extraKubeconfigs: [] });
    mount();
    expect(await screen.findByRole("button", { name: "Add repository" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Remove repository" })).toBeInTheDocument();
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
  });
});
