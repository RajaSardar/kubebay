import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PodGraphs } from "../PodGraphs";
import * as api from "../../lib/api";

vi.mock("../../lib/api");
vi.mock("../LineChart", () => ({
  LineChart: () => <div data-testid="line-chart">LineChart</div>,
}));

describe("PodGraphs with Prometheus configuration", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
  });

  function renderGraphs(promUrl: string | null = null) {
    const mockGet = vi.mocked(api.settingsApi.get);
    mockGet.mockResolvedValue({
      prometheusUrl: "",
      prometheusUrls: promUrl ? { "kind-test": promUrl } : {},
    });

    const mockQueryRange = vi.mocked(api.promApi.queryRange);
    mockQueryRange.mockResolvedValue({ data: { result: [] } });

    return render(
      <QueryClientProvider client={qc}>
        <PodGraphs cluster="kind-test" namespace="default" pod="test-pod" />
      </QueryClientProvider>,
    );
  }

  it("shows Configure button in EmptyState when Prometheus is not configured", async () => {
    renderGraphs(null);
    await waitFor(() => {
      expect(screen.getByText(/History graphs need Prometheus/i)).toBeTruthy();
    });
    const btn = screen.getByRole("button", { name: /Configure Prometheus/i });
    expect(btn).toBeTruthy();
  });

  it("opens modal when Configure button is clicked from EmptyState", async () => {
    const user = userEvent.setup();
    renderGraphs(null);
    await waitFor(() => {
      expect(screen.getByText(/History graphs need Prometheus/i)).toBeTruthy();
    });

    const btn = screen.getByRole("button", { name: /Configure Prometheus/i });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /Configure Prometheus for kind-test/i })).toBeTruthy();
    });
  });

  it("shows Configure button in error banner when Prometheus is unreachable", async () => {
    const mockGet = vi.mocked(api.settingsApi.get);
    mockGet.mockResolvedValue({
      prometheusUrl: "",
      prometheusUrls: { "kind-test": "http://localhost:9090" },
    });

    const mockQueryRange = vi.mocked(api.promApi.queryRange);
    const err = new Error("prometheus-unreachable");
    mockQueryRange.mockRejectedValue(err);

    const { container } = render(
      <QueryClientProvider client={qc}>
        <PodGraphs cluster="kind-test" namespace="default" pod="test-pod" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Prometheus is not reachable/i)).toBeTruthy();
    });

    const configBtn = screen.getByRole("button", { name: /Configure/i });
    expect(configBtn).toBeTruthy();
  });

  it("opens modal when Configure button is clicked from error banner", async () => {
    const user = userEvent.setup();
    const mockGet = vi.mocked(api.settingsApi.get);
    mockGet.mockResolvedValue({
      prometheusUrl: "",
      prometheusUrls: { "kind-test": "http://localhost:9090" },
    });

    const mockQueryRange = vi.mocked(api.promApi.queryRange);
    const err = new Error("prometheus-unreachable");
    mockQueryRange.mockRejectedValue(err);

    render(
      <QueryClientProvider client={qc}>
        <PodGraphs cluster="kind-test" namespace="default" pod="test-pod" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Prometheus is not reachable/i)).toBeTruthy();
    });

    const configBtn = screen.getByRole("button", { name: /Configure/i });
    await user.click(configBtn);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /Configure Prometheus for kind-test/i })).toBeTruthy();
    });
  });
});
