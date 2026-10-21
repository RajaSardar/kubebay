import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ComponentType } from "react";

// A page that waits on streams RBAC forbids would show its loader forever:
// the engine ends a forbidden stream, so it never syncs. Each page says what
// it can't list instead, with the API server's reasons.

const forbidden = new Map<string, string>();

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

vi.mock("../../lib/useResourceStream", () => ({
  // Everything still loading, except the streams the test forbids.
  useResourceStream: vi.fn((_c: string, gvr: string) =>
    forbidden.has(gvr) ? { rows: [], synced: false, connected: true, forbidden: forbidden.get(gvr) } : { rows: [], synced: false, connected: true },
  ),
  shouldShowSkeleton: (synced: boolean, n: number) => !synced && n === 0,
}));

vi.mock("../../lib/monaco", () => ({ DiffEditor: () => null }));

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  crdApi: { list: vi.fn(async () => []) },
  wasteApi: { workloads: vi.fn(async () => []) },
  historyApi: { status: vi.fn(async () => ({ cluster: "c1", available: false, recording: false })), series: vi.fn(async () => null) },
}));

const msg = (plural: string, group = "") =>
  `${plural}${group ? `.${group}` : ""} is forbidden: User "dev" cannot list resource "${plural}" in API group "${group}" at the cluster scope`;

async function renderPage(load: () => Promise<{ default: ComponentType }>) {
  const { default: Page } = await load();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("pages whose streams RBAC forbids", () => {
  beforeEach(() => forbidden.clear());

  it("Workloads Overview names every kind it can't list instead of sketching cards forever", async () => {
    forbidden.set("v1/pods", msg("pods"));
    forbidden.set("v1/nodes", msg("nodes"));
    await renderPage(() => import("../WorkloadsOverview"));
    expect(await screen.findByText("You can't list pods and nodes here.")).toBeInTheDocument();
    expect(screen.getByText(msg("pods"))).toBeInTheDocument();
    expect(screen.getByText(msg("nodes"))).toBeInTheDocument();
  });

  it("Timeline says it can't list events instead of connecting forever", async () => {
    forbidden.set("v1/events", msg("events"));
    await renderPage(() => import("../Timeline"));
    expect(await screen.findByText("You can't list events here.")).toBeInTheDocument();
    expect(screen.queryByText("Connecting to event stream…")).toBeNull();
  });

  it("Right-sizing says it can't list deployments instead of loading forever", async () => {
    forbidden.set("apps/v1/deployments", msg("deployments", "apps"));
    await renderPage(() => import("../RightSizing"));
    expect(await screen.findByText("You can't list deployments here.")).toBeInTheDocument();
    expect(screen.queryByText("Loading VPA recommendations…")).toBeNull();
  });

  it("Cost / Waste says it can't list nodes instead of computing forever", async () => {
    forbidden.set("v1/nodes", msg("nodes"));
    await renderPage(() => import("../CostWaste"));
    expect(await screen.findByText("You can't list nodes here.")).toBeInTheDocument();
    expect(screen.queryByText("Computing capacity accounting…")).toBeNull();
  });

  it("keeps the loader while nothing is forbidden", async () => {
    await renderPage(() => import("../Timeline"));
    expect(await screen.findByText("Connecting to event stream…")).toBeInTheDocument();
  });
});
