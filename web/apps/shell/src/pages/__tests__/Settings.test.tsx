import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Settings from "../Settings";
import * as api from "../../lib/api";

vi.mock("../../lib/api");
vi.mock("../../lib/useResourceStream");
vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "kind-test", setCluster: vi.fn(), list: [{ id: "kind-test" }], isLoading: false }),
}));
vi.mock("../../lib/theme", () => ({
  useTheme: () => ({ theme: "dawn", setTheme: vi.fn() }),
}));
vi.mock("../../lib/display", () => ({
  useDisplay: () => ({
    fontSize: "md", fontFamily: "system", density: "default",
    setFontSize: vi.fn(), setFontFamily: vi.fn(), setDensity: vi.fn(),
  }),
}));

const { useResourceStream } = await import("../../lib/useResourceStream");

describe("PrometheusSettings datalist (Slice 4)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    vi.mocked(api.settingsApi.get).mockResolvedValue({
      prometheusUrl: "",
      prometheusUrls: {},
    });
    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
  });

  function renderSettings() {
    return render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <Settings />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("shows no datalist when Default target is selected", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /Prometheus target/i })).toBeTruthy();
    });
    // Default option selected — no datalist options for Prometheus candidates
    const datalist = document.getElementById("prom-candidates");
    expect(datalist).toBeNull();
  });

  it("shows datalist options when a cluster is selected and services contain a Prometheus svc", async () => {
    const user = userEvent.setup();
    const promService = {
      metadata: { name: "prometheus-server", namespace: "monitoring", labels: {} },
      spec: { ports: [{ port: 9090 }] },
    };

    vi.mocked(useResourceStream).mockReturnValue({
      rows: [promService],
      synced: true,
      connected: true,
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /Prometheus target/i })).toBeTruthy();
    });

    // Select the cluster
    const select = screen.getByRole("combobox", { name: /Prometheus target/i });
    await user.selectOptions(select, "kind-test");

    await waitFor(() => {
      const datalist = document.getElementById("prom-candidates");
      expect(datalist).toBeTruthy();
      expect(datalist!.querySelectorAll("option").length).toBeGreaterThan(0);
    });
  });

  it("datalist option value is the localhost URL (not in-cluster DNS)", async () => {
    const user = userEvent.setup();
    const promService = {
      metadata: { name: "prometheus-server", namespace: "monitoring", labels: {} },
      spec: { ports: [{ port: 9090 }] },
    };

    vi.mocked(useResourceStream).mockReturnValue({
      rows: [promService],
      synced: true,
      connected: true,
    });

    renderSettings();

    await waitFor(() => screen.getByRole("combobox", { name: /Prometheus target/i }));

    const select = screen.getByRole("combobox", { name: /Prometheus target/i });
    await user.selectOptions(select, "kind-test");

    await waitFor(() => {
      const datalist = document.getElementById("prom-candidates");
      const option = datalist?.querySelector("option");
      expect(option?.value).toBe("http://localhost:9090");
      expect(option?.value).not.toMatch(/\.svc/);
    });
  });
});
