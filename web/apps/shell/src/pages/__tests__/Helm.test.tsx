import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Helm from "../Helm";
import { helmApi, type HelmRelease } from "../../lib/api";
import { useNamespaceStore } from "../../lib/namespace-store";

let cluster = "c1";
vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster, setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

// The release Secrets' stream (ADR 0004 S5); by default it hasn't said
// anything yet, so the page shows the list alone.
const helmSecrets = vi.hoisted(() => ({ value: { rows: [] as unknown[], synced: false, forbidden: undefined as string | undefined } }));
// The same stream over named namespaces, for an identity that can't read
// release Secrets cluster-wide (ADR 0004 S6).
const helmScoped = vi.hoisted(() => ({
  value: { rows: [] as unknown[], synced: false, denied: undefined as { ns: string; reason: string }[] | undefined },
}));
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string, opts?: { ns?: string[] }) =>
    gvr === "v1/secrets"
      ? opts?.ns
        ? helmScoped.value
        : helmSecrets.value
      : { rows: [{ metadata: { name: "shop" } }, { metadata: { name: "infra" } }], synced: true },
  ),
  shouldShowSkeleton: () => false,
}));

const releaseSecret = (namespace: string, name: string, version: number, status: string) => ({
  metadata: { namespace, name: `sh.helm.release.v1.${name}.v${version}`, labels: { owner: "helm", name, version: String(version), status } },
});

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  helmApi: { releases: vi.fn(), history: vi.fn(), valuesText: vi.fn(), manifestText: vi.fn(), details: vi.fn() },
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
const list = (r: HelmRelease[], denied: { ns: string; message: string }[] = []) => ({ releases: r, denied });

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
  helmSecrets.value = { rows: [], synced: false, forbidden: undefined };
  helmScoped.value = { rows: [], synced: false, denied: undefined };
  useNamespaceStore.setState({ selections: {} });
  vi.mocked(helmApi.releases).mockReset();
  vi.mocked(helmApi.history).mockReset();
  vi.mocked(helmApi.manifestText).mockReset();
  vi.mocked(helmApi.details).mockReset();
  vi.mocked(helmApi.details).mockReturnValue(new Promise(() => {}));
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
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases));
    useNamespaceStore.getState().setNamespaces("c1", ["infra"]);
    renderPage();
    await screen.findByText("ingress");
    expect(bodyRowNames()).toEqual(["ingress"]);
    expect(screen.getByRole("button", { name: /infra/ })).toBeInTheDocument();
  });

  it("searches by name, chart or status", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases));
    renderPage();
    await screen.findByText("redis");
    fireEvent.change(screen.getByLabelText("Filter releases"), { target: { value: "nginx" } });
    expect(bodyRowNames()).toEqual(["ingress"]);
    fireEvent.change(screen.getByLabelText("Filter releases"), { target: { value: "zzz" } });
    expect(screen.getByText(/No releases match/)).toBeInTheDocument();
  });

  it("counts what is shown out of the total when filtered", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases));
    renderPage();
    await screen.findByText("redis");
    fireEvent.change(screen.getByLabelText("Filter releases"), { target: { value: "shop" } });
    expect(screen.getByText("· 2 of 3")).toBeInTheDocument();
  });

  // ADR 0004 S8: a release opens on what it is and what it made.
  it("the release drawer opens on Overview", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases));
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status", { name: "Loading release…" })).toBeInTheDocument();
    expect(helmApi.details).toHaveBeenCalledWith("c1", "shop", "redis");
    expect(helmApi.history).not.toHaveBeenCalled();
  });

  it("the release drawer loads history and manifest with loaders, not a word", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases));
    vi.mocked(helmApi.history).mockReturnValue(new Promise(() => {}));
    vi.mocked(helmApi.manifestText).mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("status", { name: "Loading history…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Manifest" }));
    expect(screen.getByRole("status", { name: "Loading manifest…" })).toBeInTheDocument();
  });

  it("each revision in History says how it was applied", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases));
    vi.mocked(helmApi.history).mockResolvedValue([
      { ...rel("redis", "shop", "redis"), revision: 1, applyMethod: "csa" },
      { ...rel("redis", "shop", "redis"), revision: 2, applyMethod: "ssa" },
    ]);
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const rev1 = (await screen.findByText("rev 1")).closest(".tl-item") as HTMLElement;
    const rev2 = screen.getByText("rev 2").closest(".tl-item") as HTMLElement;
    expect(within(rev1).getByText("client-side apply")).toBeInTheDocument();
    expect(within(rev2).getByText("server-side apply")).toBeInTheDocument();
  });

  // ADR 0004 S3: the drawer shows the release as it is now, not as it was
  // when its row was clicked.
  it("the drawer follows the live release: after a failed upgrade it offers rollback to the last good revision", async () => {
    const at = (revision: number, status: string) => ({ ...rel("redis", "shop", "redis-18.1.0"), revision, status });
    vi.mocked(helmApi.releases).mockResolvedValue(list([at(3, "deployed")]));
    vi.mocked(helmApi.history).mockResolvedValue([at(3, "deployed"), at(2, "superseded")]);
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    await screen.findByText("rev 3");

    vi.mocked(helmApi.releases).mockResolvedValue(list([at(4, "failed")]));
    vi.mocked(helmApi.history).mockResolvedValue([at(4, "failed"), at(3, "deployed"), at(2, "superseded")]);
    await act(() => qc.invalidateQueries({ queryKey: ["helm-releases"] }));
    const rev4 = (await screen.findByText("rev 4")).closest(".tl-item") as HTMLElement;
    const rev3 = screen.getByText("rev 3").closest(".tl-item") as HTMLElement;
    expect(within(rev4).queryByRole("button", { name: "Rollback" })).toBeNull();
    expect(within(rev3).getByRole("button", { name: "Rollback" })).toBeInTheDocument();
  });

  it("the drawer says so when its release is uninstalled elsewhere", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases));
    vi.mocked(helmApi.history).mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases.filter((r) => r.name !== "redis")));
    await act(() => qc.invalidateQueries({ queryKey: ["helm-releases"] }));
    expect(await screen.findByText("This release is no longer in the cluster: it was uninstalled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Uninstall" })).toBeNull();
  });

  // A release opened from the keyboard (Enter on its row) while another's
  // drawer is open: no press reaches the page behind, so the drawer isn't
  // closed first. It must not keep the other release's chart or edited values:
  // "Save & upgrade" would install them over this release.
  it("a release opened while another's drawer is open starts from its own chart, not the last one's", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(list(releases));
    vi.mocked(helmApi.history).mockResolvedValue([]);
    vi.mocked(helmApi.valuesText).mockResolvedValue("replicas: 1\n");
    renderPage();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(screen.getByRole("tab", { name: "Values" }));
    expect(screen.getByPlaceholderText(/chart ref/)).toHaveValue("redis-18.1.0");

    fireEvent.keyDown(within(screen.getByRole("table")).getByText("api").closest("tr")!, { key: "Enter" });
    expect(screen.getByRole("dialog")).toHaveAccessibleName(/api/);
    if (screen.getByRole("tab", { name: "Values" }).getAttribute("aria-selected") !== "true") {
      fireEvent.click(screen.getByRole("tab", { name: "Values" }));
    }
    expect(screen.getByPlaceholderText(/chart ref/)).toHaveValue("api-2.0.0");
  });

  // ADR 0004 S5: rows come from the release Secrets at once; the list fills
  // in the chart and is asked for again only when a release changes.
  it("shows releases from their Secrets before the list arrives", async () => {
    vi.mocked(helmApi.releases).mockReturnValue(new Promise(() => {}));
    helmSecrets.value = { rows: [releaseSecret("shop", "redis", 4, "pending-upgrade"), releaseSecret("shop", "redis", 3, "deployed")], synced: true, forbidden: undefined };
    renderPage();
    const row = (await screen.findByText("redis")).closest("tr") as HTMLElement;
    expect(within(row).getByText("pending-upgrade")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
    // The chart comes with the list: a placeholder until then, not a blank.
    expect(row.querySelector(".kb-skeleton")).not.toBeNull();
  });

  it("asks for the list again when a release changes, and not otherwise", async () => {
    vi.mocked(helmApi.releases).mockResolvedValue(list([rel("redis", "shop", "redis-18.1.0")]));
    helmSecrets.value = { rows: [releaseSecret("shop", "redis", 1, "deployed")], synced: true, forbidden: undefined };
    const view = renderPage();
    await screen.findByText("redis-18.1.0");
    const asked = vi.mocked(helmApi.releases).mock.calls.length;

    view.rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Helm />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(vi.mocked(helmApi.releases).mock.calls.length).toBe(asked);

    helmSecrets.value = { rows: [releaseSecret("shop", "redis", 2, "deployed")], synced: true, forbidden: undefined };
    view.rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Helm />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(vi.mocked(helmApi.releases).mock.calls.length).toBe(asked + 1));
  });

  it("says it can't list Helm releases instead of claiming there are none", async () => {
    const reason = 'secrets is forbidden: User "dev" cannot list resource "secrets" in API group "" at the cluster scope';
    vi.mocked(helmApi.releases).mockRejectedValue(new Error(`list: ${reason}`));
    helmSecrets.value = { rows: [], synced: false, forbidden: reason };
    renderPage();
    expect(await screen.findByText("You can't list Helm releases here.")).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByText("Pick the namespaces you use in the namespace filter to see their releases.")).toBeInTheDocument();
    expect(screen.queryByText("No Helm releases in this cluster.")).toBeNull();
  });

  // ADR 0004 S6 (ADR 0003): an identity that can't read release Secrets
  // cluster-wide sees the releases of the namespaces it named, and which of
  // those it can't read.
  it("lists a namespace-limited identity's named namespaces and names the ones refused", async () => {
    const wide = 'secrets is forbidden: User "dev" cannot list resource "secrets" in API group "" at the cluster scope';
    const refused = 'secrets is forbidden: User "dev" cannot list resource "secrets" in API group "" in the namespace "payments"';
    helmSecrets.value = { rows: [], synced: false, forbidden: wide };
    helmScoped.value = { rows: [releaseSecret("shop", "redis", 2, "deployed")], synced: true, denied: [{ ns: "payments", reason: refused }] };
    vi.mocked(helmApi.releases).mockResolvedValue(list([{ ...rel("redis", "shop", "redis-18.1.0"), revision: 2 }], [{ ns: "payments", message: refused }]));
    useNamespaceStore.getState().setNamespaces("c1", ["shop", "payments"]);
    renderPage();
    expect(await screen.findByText("redis-18.1.0")).toBeInTheDocument();
    expect(screen.getByText("You can't list Helm releases in payments. Showing shop.")).toBeInTheDocument();
    expect(screen.getByText(refused)).toBeInTheDocument();
    expect(helmApi.releases).toHaveBeenCalledWith("c1", ["shop", "payments"]);
    expect(screen.queryByText("You can't list Helm releases here.")).toBeNull();
  });
});

