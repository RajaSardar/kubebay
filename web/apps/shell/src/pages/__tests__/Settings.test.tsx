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

describe("Settings: app-wide settings only", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    vi.mocked(api.settingsApi.get).mockResolvedValue({
      prometheusUrl: "",
      prometheusUrls: {},
      extraKubeconfigs: [],
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

  it("sets only the default Prometheus URL; each cluster's own URL lives in its row menu", async () => {
    const user = userEvent.setup();
    vi.mocked(api.settingsApi.save).mockResolvedValue(undefined as never);
    renderSettings();
    expect(await screen.findByText(/Each cluster's own URL is set from its ⋮ menu on the Clusters page/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Prometheus target/i })).not.toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Default Prometheus URL" });
    await user.type(field, "http://localhost:9090");
    await user.click(screen.getByRole("button", { name: "Save default Prometheus URL" }));
    await waitFor(() => expect(api.settingsApi.save).toHaveBeenCalledWith(expect.objectContaining({ prometheusUrl: "http://localhost:9090" })));
  });

  it("points to the Clusters page for kubeconfig files instead of managing them here", async () => {
    renderSettings();
    const link = await screen.findByRole("link", { name: "Manage kubeconfig files" });
    expect(link).toHaveAttribute("href", "/clusters?kubeconfig=1");
    expect(screen.queryByRole("button", { name: "Add file" })).not.toBeInTheDocument();
  });

  it("shows the Usage history card listing clusters with history consent", async () => {
    vi.mocked(api.settingsApi.get).mockResolvedValue({
      prometheusUrl: "",
      prometheusUrls: {},
      extraKubeconfigs: [],
      historyClusters: { "kind-dev": true },
    });
    renderSettings();
    expect(await screen.findByText("Usage history")).toBeInTheDocument();
    expect(screen.getByText("kind-dev")).toBeInTheDocument();
  });

  it("offers the MCP switch for AI assistants, off until turned on", async () => {
    vi.mocked(api.mcpApi.get).mockResolvedValue({ enabled: false, clusters: {}, url: "http://127.0.0.1:9898/mcp" });
    vi.mocked(api.api.clusters).mockResolvedValue([]);
    renderSettings();
    expect(await screen.findByText("AI assistants (MCP)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled();
  });
});
