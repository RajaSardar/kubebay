import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
      extraKubeconfigs: [],
    });

    vi.mocked(api.promApi.status).mockResolvedValue({ source: "none", target: "", chosen: false, candidates: [] });
    const mockQueryRange = vi.mocked(api.promApi.queryRange);
    mockQueryRange.mockResolvedValue({ data: { result: [] } });

    return render(
      <QueryClientProvider client={qc}>
        <PodGraphs cluster="kind-test" namespace="default" pod="test-pod" />
      </QueryClientProvider>,
    );
  }

  it("shows what was tried and the ways out when Prometheus is not found", async () => {
    renderGraphs(null);
    vi.mocked(api.promApi.status).mockResolvedValue({
      source: "none", target: "", chosen: false, candidates: [], scope: "namespaces", tried: ["monitoring", "prometheus"], forbidden: ["prometheus"],
    });
    await waitFor(() => {
      expect(screen.getByText(/Prometheus: not found/i)).toBeTruthy();
    });
    expect(screen.getByText(/Tried: monitoring, prometheus/)).toBeTruthy();
    expect(screen.getByText(/Not allowed to list Services in: prometheus/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a Service" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enter URL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy();
  });

  it("opens modal when Configure button is clicked from EmptyState", async () => {
    const user = userEvent.setup();
    renderGraphs(null);
    await waitFor(() => {
      expect(screen.getByText(/Prometheus: not found/i)).toBeTruthy();
    });

    const btn = screen.getByRole("button", { name: "Choose a Service" });
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
      extraKubeconfigs: [],
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
    expect(configBtn).toBeTruthy();
  });

  it("opens modal when Configure button is clicked from error banner", async () => {
    const user = userEvent.setup();
    const mockGet = vi.mocked(api.settingsApi.get);
    mockGet.mockResolvedValue({
      prometheusUrl: "",
      prometheusUrls: { "kind-test": "http://localhost:9090" },
      extraKubeconfigs: [],
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

  it("graphs just work when Prometheus is auto-detected, and says what it uses", async () => {
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "", prometheusUrls: {}, extraKubeconfigs: [] });
    vi.mocked(api.promApi.status).mockResolvedValue({
      source: "auto",
      target: "monitoring/prometheus-server:80",
      chosen: false,
      candidates: [],
    });
    const mockQueryRange = vi.mocked(api.promApi.queryRange);
    mockQueryRange.mockResolvedValue({ data: { result: [] } });
    render(
      <QueryClientProvider client={qc}>
        <PodGraphs cluster="kind-test" namespace="default" pod="test-pod" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("line-chart").length).toBe(2));
    expect(mockQueryRange).toHaveBeenCalled();
    expect(screen.queryByText(/History graphs need Prometheus/i)).toBeNull();
    expect(screen.getByText(/Auto-detected: monitoring\/prometheus-server:80/)).toBeTruthy();
  });

  it("asks for a URL only when nothing is configured and nothing was detected", async () => {
    vi.mocked(api.promApi.status).mockResolvedValue({ source: "none", target: "", chosen: false, candidates: [] });
    renderGraphs(null);
    await waitFor(() => expect(screen.getByText(/Prometheus: not found/i)).toBeTruthy());
  });

  it("offers no Choose or Enter URL on a shared engine, where the operator sets Prometheus", async () => {
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "", prometheusUrls: {}, extraKubeconfigs: [], sharedLocked: "in-cluster" });
    vi.mocked(api.promApi.status).mockResolvedValue({ source: "none", target: "", chosen: false, candidates: [] });
    vi.mocked(api.promApi.queryRange).mockResolvedValue({ data: { result: [] } });
    render(
      <QueryClientProvider client={qc}>
        <PodGraphs cluster="kind-test" namespace="default" pod="test-pod" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Prometheus: not found/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Choose a Service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enter URL" })).toBeNull();
  });

  const autoStatus = { source: "auto" as const, target: "monitoring/prometheus-server:80", chosen: false, candidates: [] };
  function renderAuto() {
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "", prometheusUrls: {}, extraKubeconfigs: [] });
    vi.mocked(api.promApi.status).mockResolvedValue(autoStatus);
    return render(
      <QueryClientProvider client={qc}>
        <PodGraphs cluster="kind-test" namespace="default" pod="test-pod" />
      </QueryClientProvider>,
    );
  }

  it("uses the default URL when nothing is detected, and says so", async () => {
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "http://localhost:9090", prometheusUrls: {}, extraKubeconfigs: [] });
    vi.mocked(api.promApi.status).mockResolvedValue({ source: "default", target: "http://localhost:9090", chosen: false, candidates: [] });
    vi.mocked(api.promApi.queryRange).mockResolvedValue({ data: { result: [{ metric: { container: "a" }, values: [[1, "1"]] }] } });
    render(
      <QueryClientProvider client={qc}>
        <PodGraphs cluster="kind-test" namespace="default" pod="test-pod" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("line-chart").length).toBe(2));
    expect(screen.getByText(/Default URL: http:\/\/localhost:9090/)).toBeTruthy();
  });

  it("falls back to the older pod_name labels when the current ones return nothing", async () => {
    const calls: string[] = [];
    vi.mocked(api.promApi.queryRange).mockImplementation(async ({ query }) => {
      calls.push(query);
      return { data: { result: query.includes("pod_name=") ? [{ metric: { container: "a" }, values: [[1, "1"]] }] : [] } };
    });
    renderAuto();
    await waitFor(() => expect(screen.getAllByTestId("line-chart").length).toBe(2));
    expect(calls.some((q) => q.includes('pod="test-pod"') && q.includes('container!=""'))).toBe(true);
    expect(calls.some((q) => q.includes('pod_name="test-pod"'))).toBe(true);
  });

  it("says when Prometheus answered but has no series for the pod, with a way to test it", async () => {
    vi.mocked(api.promApi.queryRange).mockResolvedValue({ data: { result: [] } });
    renderAuto();
    await waitFor(() => expect(screen.getByText(/returned no CPU or memory series for this pod/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy();
    expect(screen.queryAllByTestId("line-chart").length).toBe(0);
  });

  it("shows the real reason a query failed, with a way to test it", async () => {
    vi.mocked(api.promApi.queryRange).mockRejectedValue(new Error("Forbidden: you may not read this Prometheus through the cluster's API server (services/proxy)."));
    renderAuto();
    await waitFor(() => expect(screen.getByText(/Forbidden: you may not read this Prometheus/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy();
  });
});
