import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Palette } from "../Palette";
import { useClusterStore } from "../../lib/cluster-store";
import { getClusterRows, getConnectedClusters } from "../../lib/clusterConnections";
import { searchApi, type SearchResponse } from "../../lib/api";

vi.mock("../../lib/clusterConnections", () => ({
  getConnectedClusters: vi.fn(() => new Set(["prod"])),
  getClusterRows: vi.fn(() => []),
  isClusterSynced: vi.fn(() => true),
  subscribeConnections: () => () => {},
  connectCluster: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, clusters: vi.fn(async () => []), pfList: vi.fn(async () => []) },
    historyApi: { ...actual.historyApi, enroll: vi.fn(async () => {}) },
    searchApi: { search: vi.fn() },
  };
});

const reply = (over: Partial<SearchResponse> = {}): SearchResponse => ({ groups: [], filter: "", indexed: 0, pending: [], onDemand: [], truncated: [], denied: [], ...over });
const group = (slug: string, label: string, hits: [string, string][], extra: { clusterScoped?: boolean; total?: number } = {}) => ({
  slug,
  label,
  total: extra.total ?? hits.length,
  clusterScoped: extra.clusterScoped ?? false,
  hits: hits.map(([ns, name]) => ({ ns, name, score: 90 })),
});

function Where() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname + l.search}</div>;
}

function renderPalette() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/"]}>
        <Palette open onClose={() => {}} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const type = (v: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: v } });

beforeEach(() => {
  localStorage.clear();
  useClusterStore.setState({ active: "prod" });
  vi.mocked(getConnectedClusters).mockReturnValue(new Set(["prod"]));
  vi.mocked(getClusterRows).mockReset().mockImplementation((_c, gvr) =>
    gvr === "apps/v1/deployments" ? [{ metadata: { name: "api", namespace: "shop" } }, { metadata: { name: "rollouts-api", namespace: "shop" } }] : [],
  );
  vi.mocked(searchApi.search).mockReset().mockResolvedValue(reply());
});

describe("Palette: kinds the app does not hold in memory", () => {
  it("shows what the engine found, next to what the app already holds, and opens it", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ groups: [group("services", "Services", [["shop", "api"]])] }));
    renderPalette();
    type("api");
    expect(screen.getByRole("button", { name: /^api in shop/ })).toBeInTheDocument(); // the Deployment, at once
    const svc = await screen.findByText("Services");
    expect(svc).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { name: /^api in shop/ });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]!);
    expect(screen.getByTestId("at").textContent).toMatch(/^\/detail\/(services|deployments)\/shop\/api$/);
  });

  it("opens a Service on its own page", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ groups: [group("services", "Services", [["shop", "checkout"]])] }));
    renderPalette();
    type("checkout");
    fireEvent.click(await screen.findByRole("button", { name: /^checkout in shop/ }));
    expect(screen.getByTestId("at").textContent).toBe("/detail/services/shop/checkout");
  });

  it("opens a custom resource such as a Rollout on its detail route", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ groups: [group("ext--argoproj.io--v1alpha1--rollouts", "Rollouts", [["shop", "storefront"]])] }));
    renderPalette();
    type("storefront");
    fireEvent.click(await screen.findByRole("button", { name: /^storefront in shop/ }));
    expect(screen.getByTestId("at").textContent).toBe("/detail/ext--argoproj.io--v1alpha1--rollouts/shop/storefront");
  });

  it("tells the route a custom resource has no namespace", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ groups: [group("ext--acme.example--v1--widgets", "Widgets", [["", "w1"]], { clusterScoped: true })] }));
    renderPalette();
    type("widget w");
    fireEvent.click(await screen.findByRole("button", { name: /^w1$/ }));
    expect(screen.getByTestId("at").textContent).toBe("/detail/ext--acme.example--v1--widgets/_/w1?scoped=0");
  });

  it("opens a CRD on the CRDs page, filtered to its API group", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ groups: [group("crds", "CRDs", [["", "rollouts.argoproj.io"]])] }));
    renderPalette();
    type("crd rollouts");
    fireEvent.click(await screen.findByRole("button", { name: /rollouts\.argoproj\.io/ }));
    expect(screen.getByTestId("at").textContent).toBe("/crds?group=argoproj.io");
  });

  it("offers 'show all' for an engine kind and opens that kind's list filtered", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ groups: [group("services", "Services", [["shop", "svc-1"], ["shop", "svc-2"]], { total: 14 })] }));
    renderPalette();
    type("svc-");
    fireEvent.click(await screen.findByRole("button", { name: /show all 14 services/i }));
    expect(screen.getByTestId("at").textContent).toBe("/r/services?q=svc-");
  });

  it("does not ask the engine for a kind it already holds", async () => {
    renderPalette();
    type("deploy api");
    await new Promise((r) => setTimeout(r, 250));
    expect(searchApi.search).not.toHaveBeenCalled();
  });

  it("hides lookalike local matches when the query names an engine kind", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ filter: "ext--argoproj.io--v1alpha1--rollouts", groups: [group("ext--argoproj.io--v1alpha1--rollouts", "Rollouts", [["shop", "storefront"]])] }));
    renderPalette();
    type("rollouts api"); // a Deployment called rollouts-api matches both words
    await screen.findByText("Rollouts");
    await waitFor(() => expect(screen.queryByRole("button", { name: /^rollouts-api in shop/ })).toBeNull());
  });
});

describe("Palette: saying what it could not search", () => {
  it("says which kinds are still listing", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ pending: ["Ingresses", "Custom resources"] }));
    renderPalette();
    type("api");
    expect(await screen.findByText(/still loading ingresses, custom resources/i)).toBeInTheDocument();
  });

  it("says which kinds your access does not allow", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ denied: [{ label: "Secrets", reason: "forbidden: cannot list secrets" }] }));
    renderPalette();
    type("api");
    expect(await screen.findByText(/can't list secrets/i)).toBeInTheDocument();
  });

  it("says when a kind was too big to search whole", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ truncated: ["ConfigMaps"] }));
    renderPalette();
    type("api");
    expect(await screen.findByText(/too many configmaps/i)).toBeInTheDocument();
  });

  it("says which kinds you reach by naming them, with an example", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ onDemand: ["Events", "Leases", "Endpoints"] }));
    renderPalette();
    type("crash");
    const note = await screen.findByText(/not searched unless you name them/i);
    expect(note.textContent).toMatch(/events, leases, endpoints/i);
    expect(note.textContent).toMatch(/events crash/i);
  });

  it("gives a real, one-word example, not a two-word kind glued to your text", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ onDemand: ["CSI Capacities", "Events", "Leases"] }));
    renderPalette();
    type("rollout");
    const note = await screen.findByText(/not searched unless you name them/i);
    expect(note.textContent).toMatch(/try: events rollout/i);
    expect(note.textContent).not.toMatch(/csi capacities rollout/i);
  });

  it("shows why a kind could not be listed, as text and not only in a tooltip", async () => {
    vi.mocked(searchApi.search).mockResolvedValue(reply({ denied: [{ label: "Custom resources", reason: "API discovery: the server is too slow" }] }));
    renderPalette();
    type("api");
    expect(await screen.findByText(/can't list custom resources/i)).toBeInTheDocument();
    expect(screen.getByText(/too slow/i)).toBeInTheDocument();
  });

  it("keeps the local results and says so when the engine cannot be reached", async () => {
    vi.mocked(searchApi.search).mockRejectedValue(new Error("502 bad gateway"));
    renderPalette();
    type("api");
    expect(await screen.findByText(/couldn't search other kinds/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^api in shop/ })).toBeInTheDocument();
  });
});
