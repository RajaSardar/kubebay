import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
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

vi.mock("../../lib/monaco", () => ({ default: () => <div data-testid="editor" /> }));

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

let qc: QueryClient;
function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

  it("each revision in History says how it was applied", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(releases);
    vi.mocked(helmApi.history).mockResolvedValue([
      { ...rel("redis", "shop", "redis"), revision: 1, applyMethod: "csa" },
      { ...rel("redis", "shop", "redis"), revision: 2, applyMethod: "ssa" },
    ]);
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    const rev1 = (await screen.findByText("rev 1")).closest(".tl-item") as HTMLElement;
    const rev2 = screen.getByText("rev 2").closest(".tl-item") as HTMLElement;
    expect(within(rev1).getByText("client-side apply")).toBeInTheDocument();
    expect(within(rev2).getByText("server-side apply")).toBeInTheDocument();
  });

  // ADR 0004 S3: the drawer shows the release as it is now, not as it was
  // when its row was clicked.
  it("the drawer follows the live release: after a failed upgrade it offers rollback to the last good revision", async () => {
    const at = (revision: number, status: string) => ({ ...rel("redis", "shop", "redis-18.1.0"), revision, status });
    vi.mocked(helmApi.releases).mockResolvedValue([at(3, "deployed")]);
    vi.mocked(helmApi.history).mockResolvedValue([at(3, "deployed"), at(2, "superseded")]);
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    await screen.findByText("rev 3");

    vi.mocked(helmApi.releases).mockResolvedValue([at(4, "failed")]);
    vi.mocked(helmApi.history).mockResolvedValue([at(4, "failed"), at(3, "deployed"), at(2, "superseded")]);
    await act(() => qc.invalidateQueries({ queryKey: ["helm-releases"] }));
    const rev4 = (await screen.findByText("rev 4")).closest(".tl-item") as HTMLElement;
    const rev3 = screen.getByText("rev 3").closest(".tl-item") as HTMLElement;
    expect(within(rev4).queryByRole("button", { name: "Rollback" })).toBeNull();
    expect(within(rev3).getByRole("button", { name: "Rollback" })).toBeInTheDocument();
  });

  it("the drawer says so when its release is uninstalled elsewhere", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(releases);
    vi.mocked(helmApi.history).mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    vi.mocked(helmApi.releases).mockResolvedValue(releases.filter((r) => r.name !== "redis"));
    await act(() => qc.invalidateQueries({ queryKey: ["helm-releases"] }));
    expect(await screen.findByText("This release is no longer in the cluster: it was uninstalled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Uninstall" })).toBeNull();
  });
});
