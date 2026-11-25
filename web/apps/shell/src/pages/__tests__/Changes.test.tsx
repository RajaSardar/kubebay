import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Changes from "../Changes";
import { timelineApi } from "../../lib/api";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
vi.mock("../../lib/useCluster", () => ({ useCluster: () => ({ cluster: "kind-dev", setCluster: vi.fn(), list: [], isLoading: false }) }));

const change = (over = {}) => ({
  id: 1,
  cluster: "kind-dev",
  ts: "2026-03-01T12:00:00Z",
  group: "apps",
  version: "v1",
  resource: "deployments",
  kind: "Deployment",
  namespace: "shop",
  name: "api",
  op: "update",
  fieldManager: "argocd-controller",
  fields: [{ path: "spec.replicas", kind: "changed" }],
  ...over,
});

vi.mock("../../lib/api", () => ({
  timelineApi: { status: vi.fn(), changes: vi.fn(), facets: vi.fn() },
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Changes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const on = { enabled: true, retentionDays: 7, rows: 3, dbBytes: 1, capBytes: 2, evicted: 0, dropped: 0 };

describe("Changes page (backlog 82)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(timelineApi.status).mockResolvedValue(on);
    vi.mocked(timelineApi.facets).mockResolvedValue({ kinds: ["Deployment"], namespaces: ["shop"], managers: ["argocd-controller"] });
    vi.mocked(timelineApi.changes).mockResolvedValue({
      changes: [change() as never, change({ id: 2, name: "gone", op: "delete", fields: [] }) as never],
      coverage: [{ kind: "Deployment", gaps: [{ from: "2026-03-01T02:00:00Z", to: "2026-03-01T05:00:00Z", reason: "the app was not running or the watch was not open" }] }],
      from: "2026-03-01T00:00:00Z",
      to: "2026-03-01T10:00:00Z",
      dropped: 0,
    });
  });

  it("lists changes with the field manager and the changed paths", async () => {
    renderPage();
    expect(await screen.findByText("update: spec.replicas")).toBeInTheDocument();
    const row = screen.getByText("update: spec.replicas").closest("tr")!;
    expect(within(row).getByText("argocd-controller")).toBeInTheDocument();
  });

  it("shows a not-recorded band for a kind with a gap", async () => {
    renderPage();
    const band = await screen.findByTestId("gap-band");
    expect(band.getAttribute("title")).toMatch(/Not recorded/);
    expect(screen.getByRole("img", { name: /Deployment: not recorded in 1 period/ })).toBeInTheDocument();
  });

  it("opens the object when a row is clicked, and nothing for a deleted one", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("update: spec.replicas"));
    expect(navigate).toHaveBeenCalledWith("/detail/deployments/shop/api");
    navigate.mockClear();
    fireEvent.click(screen.getByText("gone"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sends the chosen filters to the engine", async () => {
    renderPage();
    await screen.findByText("update: spec.replicas");
    await waitFor(() => expect(within(screen.getByLabelText("Kind")).getByText("Deployment")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "Deployment" } });
    fireEvent.change(screen.getByLabelText("Field manager"), { target: { value: "argocd-controller" } });
    await waitFor(() => {
      const last = vi.mocked(timelineApi.changes).mock.calls.at(-1)![0];
      expect(last).toContain("kind=Deployment");
      expect(last).toContain("manager=argocd-controller");
    });
  });

  it("says how many changes were dropped", async () => {
    vi.mocked(timelineApi.changes).mockResolvedValue({ changes: [], coverage: [], from: "2026-03-01T00:00:00Z", to: "2026-03-01T10:00:00Z", dropped: 7 });
    renderPage();
    expect(await screen.findByText(/7 changes not recorded/)).toBeInTheDocument();
  });

  it("explains that it is off, without asking for changes", async () => {
    vi.mocked(timelineApi.status).mockResolvedValue({ ...on, enabled: false, retentionDays: 0 });
    renderPage();
    expect(await screen.findByText("The change timeline is off.")).toBeInTheDocument();
    expect(timelineApi.changes).not.toHaveBeenCalled();
  });

  it("shows the engine's reason on a shared engine", async () => {
    vi.mocked(timelineApi.status).mockRejectedValue(new Error("The change timeline is not kept when OIDC or an auth proxy is configured."));
    renderPage();
    expect(await screen.findByText(/not kept when OIDC or an auth proxy/)).toBeInTheDocument();
    expect(timelineApi.changes).not.toHaveBeenCalled();
  });
});
