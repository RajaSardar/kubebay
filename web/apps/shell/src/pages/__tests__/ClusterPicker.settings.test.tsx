import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SettingsDrawerHost } from "../../components/SettingsDrawerHost";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ClusterPicker from "../ClusterPicker";
import { api, historyApi, settingsApi, type ClusterInfo } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, clusters: vi.fn(), disconnectCluster: vi.fn(), fleetSummary: vi.fn() },
    historyApi: { ...actual.historyApi, enroll: vi.fn(() => Promise.resolve()), summary: vi.fn() },
    settingsApi: { ...actual.settingsApi, get: vi.fn() },
  };
});
vi.mock("../../lib/clusterChannel", () => ({ announceDisconnect: vi.fn(), onRemoteDisconnect: vi.fn(() => () => {}) }));
vi.mock("../../lib/clusterConnections", () => ({
  connectCluster: vi.fn(), disconnectCluster: vi.fn(), subscribeConnections: () => () => {},
  getConnectionsVersion: () => 0, connectionError: () => "", clusterSummary: () => null,
}));
vi.mock("../../lib/useResourceStream");

const dev: ClusterInfo = { id: "kind-dev", context: "kind-dev", server: "https://127.0.0.1:6443", status: "reachable", version: "v1.31.0" };

function renderPage(route = "/clusters") {
  vi.mocked(api.clusters).mockResolvedValue([dev]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <ClusterPicker />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Clusters page settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(historyApi.summary).mockResolvedValue({ available: true, bucketHours: 4, clusters: {} });
    vi.mocked(settingsApi.get).mockResolvedValue({ prometheusUrl: "", extraKubeconfigs: [] });
  });

  it("does not load settings until the button is used", async () => {
    renderPage();
    await screen.findByText("kind-dev");
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(settingsApi.get).not.toHaveBeenCalled();
  });

  it("opens the settings drawer from the button and closes it with Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Theme")).toBeInTheDocument();
    expect(screen.queryByText("This cluster")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Theme")).not.toBeInTheDocument());
  });

  it("opens the drawer straight from ?settings=1", async () => {
    renderPage("/clusters?settings=1");
    expect(await screen.findByText("Theme")).toBeInTheDocument();
  });

  it("opens the kubeconfig dialog from the drawer without leaving the page", async () => {
    const user = userEvent.setup();
    renderPage("/clusters?settings=1");
    await user.click(await screen.findByText("Manage kubeconfig files"));
    expect(await screen.findByRole("dialog", { name: "Kubeconfig sources" })).toBeInTheDocument();
  });

  it("keeps the settings UI out of the picker's static imports", () => {
    const src = readFileSync(resolve(process.cwd(), "src/pages/ClusterPicker.tsx"), "utf8");
    expect(src).not.toMatch(/^import[^\n]*settings\/Settings(Body|Drawer)/m);
    expect(src).toMatch(/lazy\(\(\) => import\("\.\/settings\/SettingsDrawer"\)\)/);
  });

  it("says so with a Retry when the settings code fails to load", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const Broken = () => { throw new Error("chunk"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SettingsDrawerHost Drawer={Broken} onRetry={onRetry} onClose={() => {}} onManageKubeconfigs={() => {}} />);
    expect(await screen.findByText(/Couldn't load settings/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
