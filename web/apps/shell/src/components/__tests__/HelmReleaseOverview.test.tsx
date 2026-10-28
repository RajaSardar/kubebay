import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { HelmRelease, ReleaseDetails } from "../../lib/api";

// ADR 0004 S8: a release's Overview, its drawer's first tab: what it is,
// whether it's stuck, everything it created (grouped, each a link to its
// page), its hooks and its notes.

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  helmApi: { details: vi.fn() },
}));
const { helmApi } = await import("../../lib/api");
const { ReleaseOverview } = await import("../HelmReleaseOverview");

const rel: HelmRelease = {
  name: "web",
  namespace: "shop",
  chart: "web",
  chartVersion: "1.2.0",
  appVersion: "2.0",
  status: "deployed",
  revision: 3,
  updated: new Date(Date.now() - 2 * 60_000).toISOString(),
  description: "Upgrade complete",
  applyMethod: "ssa",
};

const details: ReleaseDetails = {
  release: rel,
  notes: "Visit http://web.shop.svc",
  resources: [
    { apiVersion: "v1", kind: "Service", resource: "services", namespace: "shop", name: "web", namespaced: true, served: true },
    { apiVersion: "apps/v1", kind: "Deployment", resource: "deployments", namespace: "shop", name: "web", namespaced: true, served: true },
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", resource: "clusterroles", name: "web-reader", namespaced: false, served: true },
    { apiVersion: "example.com/v1", kind: "Widget", namespace: "shop", name: "gizmo", namespaced: true, served: false },
  ],
  hooks: [
    { kind: "Job", name: "web-migrate", events: ["pre-install", "pre-upgrade"], phase: "Succeeded", completedAt: new Date(Date.now() - 3 * 60_000).toISOString(), deletePolicies: ["hook-succeeded"] },
  ],
};

function renderOverview(r: HelmRelease = rel) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ReleaseOverview cluster="c1" rel={r} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReleaseOverview", () => {
  beforeEach(() => {
    vi.mocked(helmApi.details).mockClear();
  });

  it("says what the release is", async () => {
    vi.mocked(helmApi.details).mockResolvedValue(details);
    renderOverview();
    expect(await screen.findByText("web 1.2.0")).toBeInTheDocument();
    expect(screen.getByText("2.0")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Upgrade complete")).toBeInTheDocument();
    expect(helmApi.details).toHaveBeenCalledWith("c1", "shop", "web");
  });

  it("lists what it created, grouped, each linked to its page; a kind no longer served isn't", async () => {
    vi.mocked(helmApi.details).mockResolvedValue(details);
    renderOverview();
    const workloads = await screen.findByRole("region", { name: "Workloads" });
    expect(within(workloads).getByRole("link", { name: "web" })).toHaveAttribute("href", "/detail/deployments/shop/web");
    expect(within(screen.getByRole("region", { name: "Networking" })).getByRole("link", { name: "web" })).toHaveAttribute("href", "/detail/services/shop/web");
    expect(within(screen.getByRole("region", { name: "Access" })).getByRole("link", { name: "web-reader" })).toHaveAttribute("href", "/detail/clusterroles/_/web-reader");
    const other = screen.getByRole("region", { name: "Other" });
    expect(within(other).queryByRole("link")).toBeNull();
    expect(within(other).getByText("gizmo")).toBeInTheDocument();
    expect(within(other).getByText("not served by this cluster")).toBeInTheDocument();
  });

  it("shows its hooks and how their last run went, and its notes", async () => {
    vi.mocked(helmApi.details).mockResolvedValue(details);
    renderOverview();
    const hooks = await screen.findByRole("region", { name: "Hooks" });
    expect(within(hooks).getByText("web-migrate")).toBeInTheDocument();
    expect(within(hooks).getByText("pre-install, pre-upgrade")).toBeInTheDocument();
    expect(within(hooks).getByText(/Succeeded/)).toBeInTheDocument();
    expect(within(hooks).getByText("deleted when it succeeds")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Notes" })).getByText("Visit http://web.shop.svc")).toBeInTheDocument();
  });

  it("says when a change has outlasted Helm's timeout", async () => {
    const stuck = { ...rel, status: "pending-upgrade", updated: new Date(Date.now() - 12 * 60_000).toISOString() };
    vi.mocked(helmApi.details).mockResolvedValue({ ...details, release: stuck });
    renderOverview(stuck);
    expect(await screen.findByText(/pending-upgrade for 12 minutes, longer than Helm's 5-minute timeout/)).toBeInTheDocument();
  });

  it("loads with skeleton lines", () => {
    vi.mocked(helmApi.details).mockReturnValue(new Promise(() => {}));
    renderOverview();
    expect(screen.getByRole("status", { name: "Loading release…" })).toBeInTheDocument();
  });

  it("says why when it can't read the release", async () => {
    vi.mocked(helmApi.details).mockImplementation(async () => {
      throw new Error('secrets is forbidden: User "dev" cannot list resource "secrets"');
    });
    renderOverview();
    expect(await screen.findByText(/cannot list resource "secrets"/)).toBeInTheDocument();
  });
});
