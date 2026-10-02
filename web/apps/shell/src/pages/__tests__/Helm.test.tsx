import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Helm from "../Helm";
import { helmApi, type HelmRelease } from "../../lib/api";
import { useNamespaceStore } from "../../lib/namespace-store";

let cluster = "c1";
vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster, setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn(() => ({
    rows: [{ metadata: { name: "shop" } }, { metadata: { name: "infra" } }],
    synced: true,
  })),
  shouldShowSkeleton: () => false,
}));

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  helmApi: { releases: vi.fn(), history: vi.fn(), valuesText: vi.fn(), manifestText: vi.fn() },
}));

vi.mock("@monaco-editor/react", () => ({ default: () => <div data-testid="editor" /> }));

const rel = (name: string, namespace: string, chart: string): HelmRelease => ({
  name,
  namespace,
  chart,
  chartVersion: "1.0.0",
  status: "deployed",
  revision: 1,
  updated: new Date().toISOString(),
});

const releases = [rel("redis", "shop", "redis-18.1.0"), rel("api", "shop", "api-2.0.0"), rel("ingress", "infra", "ingress-nginx-4.9.0")];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Helm />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function bodyRowNames() {
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td")?.textContent);
}

beforeEach(() => {
  cluster = "c1";
  useNamespaceStore.setState({ selections: {} });
  vi.mocked(helmApi.releases).mockReset();
  vi.mocked(helmApi.history).mockReset();
  vi.mocked(helmApi.manifestText).mockReset();
});

describe("Helm releases", () => {
  it("shows the helm-wheel spinner and what it is loading while releases load", () => {
    vi.mocked(helmApi.releases).mockReturnValue(new Promise(() => {}));
    renderPage();
    const caption = screen.getByRole("table").querySelector("caption.kb-table-loading")!;
    expect(caption.querySelector(".kb-spinner")).not.toBeNull();
    expect(caption).toHaveTextContent("Loading Helm releases…");
  });

  it("shows the spinner, not bare text, while no cluster is selected", () => {
    cluster = "";
    renderPage();
    expect(screen.getByRole("status", { name: "Waiting for a cluster…" })).toBeInTheDocument();
  });

  it("filters by the shared namespace selection", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(releases);
    useNamespaceStore.getState().setNamespaces("c1", ["infra"]);
    renderPage();
    await screen.findByText("ingress");
    expect(bodyRowNames()).toEqual(["ingress"]);
    expect(screen.getByRole("button", { name: /infra/ })).toBeInTheDocument();
  });

  it("searches by name, chart or status", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(releases);
    renderPage();
    await screen.findByText("redis");
    fireEvent.change(screen.getByLabelText("Filter releases"), { target: { value: "nginx" } });
    expect(bodyRowNames()).toEqual(["ingress"]);
    fireEvent.change(screen.getByLabelText("Filter releases"), { target: { value: "zzz" } });
    expect(screen.getByText(/No releases match/)).toBeInTheDocument();
  });

  it("counts what is shown out of the total when filtered", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(releases);
    renderPage();
    await screen.findByText("redis");
    fireEvent.change(screen.getByLabelText("Filter releases"), { target: { value: "shop" } });
    expect(screen.getByText("· 2 of 3")).toBeInTheDocument();
  });

  it("the release drawer loads history and manifest with loaders, not a word", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(releases);
    vi.mocked(helmApi.history).mockReturnValue(new Promise(() => {}));
    vi.mocked(helmApi.manifestText).mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    expect(screen.getByRole("status", { name: "Loading history…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Manifest" }));
    expect(screen.getByRole("status", { name: "Loading manifest…" })).toBeInTheDocument();
  });
});
