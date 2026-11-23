import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

const REASON =
  "Settings are read-only when OIDC is configured: they would apply to every user, so the operator sets them through the engine's flags or the Helm chart's values.";

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Settings />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const lockedFields = ["Default Prometheus URL", "Node shell image", "Debug image"];
const lockedSaves = ["Save default Prometheus URL", "Save node shell image", "Save debug image"];

describe("Settings on a shared engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    vi.mocked(api.promApi.status).mockResolvedValue({ source: "auto", target: "monitoring/prometheus-server:80", chosen: false, candidates: [] });
  });

  it("says why the settings are read-only and disables the locked fields and their Save", async () => {
    vi.mocked(api.settingsApi.get).mockResolvedValue({
      prometheusUrl: "http://prometheus.monitoring:9090",
      extraKubeconfigs: [],
      nodeShellImage: "mirror.corp/busybox:1",
      debugImage: "mirror.corp/debug:1",
      sharedLocked: REASON,
    });
    renderSettings();
    expect(await screen.findByText(REASON)).toBeInTheDocument();
    for (const name of lockedFields) expect(screen.getByRole("textbox", { name })).toBeDisabled();
    for (const name of lockedSaves) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Change Prometheus for kind-test" })).toBeDisabled();
    // What is in force is still shown.
    expect(screen.getByRole("textbox", { name: "Node shell image" })).toHaveValue("mirror.corp/busybox:1");
  });

  it("keeps every field editable on the desktop", async () => {
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "", extraKubeconfigs: [] });
    renderSettings();
    expect(await screen.findByRole("textbox", { name: "Default Prometheus URL" })).toBeEnabled();
    for (const name of lockedFields) expect(screen.getByRole("textbox", { name })).toBeEnabled();
    for (const name of lockedSaves) expect(screen.getByRole("button", { name })).toBeEnabled();
    expect(await screen.findByRole("button", { name: "Change Prometheus for kind-test" })).toBeEnabled();
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
  });
});
