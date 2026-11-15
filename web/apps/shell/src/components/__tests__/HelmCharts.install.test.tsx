import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChartsTab } from "../HelmCharts";
import { helmMarketApi, type HelmChartEntry } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  helmMarketApi: { repos: vi.fn(), charts: vi.fn(), chartValuesText: vi.fn(), updateRepos: vi.fn(), addRepo: vi.fn() },
}));
vi.mock("../../lib/monaco", () => ({ default: () => <div data-testid="editor" /> }));

const chart = (name: string, version: string): HelmChartEntry => ({ name, version, description: "", versions: 1 });

// The install panel seeds its release name, version and values from the chart
// it opened with. Opening another chart while it's open (a screen reader's
// click arrives with no press first, so nothing closes the panel) must start
// from that chart, not install it under the last one's name and values.
describe("Install panel", () => {
  it("opened on another chart while open, starts from that chart", async () => {
    vi.mocked(helmMarketApi.repos).mockResolvedValue([{ name: "bitnami", url: "https://charts.bitnami.com/bitnami" }]);
    vi.mocked(helmMarketApi.charts).mockResolvedValue([chart("redis", "18.1.0"), chart("nginx", "15.0.0")]);
    vi.mocked(helmMarketApi.chartValuesText).mockResolvedValue("replicas: 1\n");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ChartsTab cluster="c1" />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText("redis"));
    expect(screen.getByPlaceholderText("release name")).toHaveValue("redis");

    fireEvent.click(screen.getAllByText("nginx")[0]!);
    expect(screen.getByPlaceholderText("release name")).toHaveValue("nginx");
  });
});
