import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsBody } from "../settings/SettingsBody";
import * as api from "../../lib/api";

vi.mock("../../lib/api");
vi.mock("../../lib/useResourceStream");
vi.mock("../../lib/theme", () => ({ useTheme: () => ({ theme: "dawn", setTheme: vi.fn() }) }));
vi.mock("../../lib/display", () => ({
  useDisplay: () => ({
    fontSize: "md", fontFamily: "system", density: "default",
    setFontSize: vi.fn(), setFontFamily: vi.fn(), setDensity: vi.fn(),
  }),
}));

const { useResourceStream } = await import("../../lib/useResourceStream");
const REASON = "Settings are read-only when OIDC is configured.";

function renderBody(props: Parameters<typeof SettingsBody>[0] = {}, route = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={qc}>
        <SettingsBody {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SettingsBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    vi.mocked(api.promApi.status).mockResolvedValue({ source: "auto", target: "monitoring/prometheus-server:80", chosen: false, candidates: [] });
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "", extraKubeconfigs: [] });
  });

  it("shows This cluster first when a cluster is open, and not without one", async () => {
    const { unmount } = renderBody({ cluster: "kind-test" });
    const heading = await screen.findByText("This cluster");
    expect(heading.closest("[id='this-cluster']")).not.toBeNull();
    expect(await screen.findByText(/Auto-detected for kind-test/)).toBeInTheDocument();
    const titles = Array.from(document.querySelectorAll(".settings-section-title, .rbac-section-title")).map((e) => e.textContent);
    expect(titles[0]).toBe("This cluster");
    unmount();
    renderBody({});
    await screen.findByText("Theme");
    expect(screen.queryByText("This cluster")).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto-detected for/)).not.toBeInTheDocument();
  });

  it("locks the same fields with the same reason with or without a cluster", async () => {
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "", extraKubeconfigs: [], sharedLocked: REASON });
    renderBody({});
    expect(await screen.findByText(REASON)).toBeInTheDocument();
    for (const name of ["Default Prometheus URL", "Node shell image", "Debug image"]) {
      expect(screen.getByRole("textbox", { name })).toBeDisabled();
    }
  });

  it("opens the kubeconfig dialog through onManageKubeconfigs instead of navigating", async () => {
    const user = userEvent.setup();
    const onManage = vi.fn();
    renderBody({ onManageKubeconfigs: onManage });
    await user.click(await screen.findByText("Manage kubeconfig files"));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when settings fail to load, keeps Theme and Display, and Retry loads them", async () => {
    const user = userEvent.setup();
    vi.mocked(api.settingsApi.get).mockRejectedValueOnce(new Error("boom"));
    renderBody({});
    expect(await screen.findByText(/Couldn't load settings/)).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Display")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Couldn't load settings/)).not.toBeInTheDocument());
    expect(await screen.findByRole("textbox", { name: "Default Prometheus URL" })).toBeInTheDocument();
  });

  it("scrolls to the card named by the URL hash", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderBody({}, "/#kubeconfig-sources");
    await screen.findByText("Manage kubeconfig files");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });
});
