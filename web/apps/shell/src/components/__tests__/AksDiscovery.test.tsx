import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AksDiscovery } from "../AksDiscovery";
import { cloudDiscoveryApi, type DiscoveredAksCluster } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  cloudDiscoveryApi: { azureSubscriptions: vi.fn(), scanAks: vi.fn(), importAks: vi.fn() },
}));

const sub = "1a2b3c4d-1111-2222-3333-444455556666";

const cluster = (name: string, over: Partial<DiscoveredAksCluster> = {}): DiscoveredAksCluster => ({
  subscription: sub,
  resourceGroup: "shop-rg",
  name,
  location: "westeurope",
  context: `aks_1a2b3c4d_shop-rg_${name}`,
  endpoint: `${name}-dns.hcp.westeurope.azmk8s.io`,
  status: "Running",
  version: "1.31.2",
  entraID: true,
  importable: true,
  imported: false,
  ...over,
});

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AksDiscovery />
    </QueryClientProvider>,
  );
}

describe("AksDiscovery (backlog #14)", () => {
  beforeEach(() => {
    vi.mocked(cloudDiscoveryApi.azureSubscriptions)
      .mockReset()
      .mockResolvedValue([
        { id: sub, name: "Prod", default: true },
        { id: "2b2b2b2b-0000-0000-0000-000000000000", name: "Sandbox" },
      ]);
    vi.mocked(cloudDiscoveryApi.scanAks)
      .mockReset()
      .mockResolvedValue({
        clusters: [
          cluster("web"),
          cluster("core", { imported: true, private: true }),
          cluster("legacy", { resourceGroup: "old-rg", entraID: false, importable: false, reason: "uses local Kubernetes accounts, not Microsoft Entra ID" }),
        ],
        errors: [],
      });
    vi.mocked(cloudDiscoveryApi.importAks).mockReset().mockResolvedValue({ path: "/home/me/.kubebay/discovered/aks.yaml", context: cluster("web").context });
  });

  it("runs nothing until asked", () => {
    renderIt();
    expect(screen.getByRole("button", { name: "Find AKS clusters" })).toBeInTheDocument();
    expect(cloudDiscoveryApi.azureSubscriptions).not.toHaveBeenCalled();
  });

  it("scans az's default subscription and imports an Entra ID cluster", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find AKS clusters" }));
    const select = await screen.findByRole("combobox", { name: "Azure subscription" });
    await waitFor(() => expect(select).toHaveValue(sub));
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(cloudDiscoveryApi.scanAks).toHaveBeenCalledWith(sub));
    expect(await screen.findByText("web")).toBeInTheDocument();
    expect(screen.getByText("in your kubeconfig")).toBeInTheDocument();
    expect(screen.getByText("private")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import web" }));
    await waitFor(() => expect(cloudDiscoveryApi.importAks).toHaveBeenCalledWith(sub, "shop-rg", "web"));
    expect(await screen.findByText("imported")).toBeInTheDocument();
  });

  it("says why a local-accounts cluster can't be imported, with no button", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find AKS clusters" }));
    await screen.findByRole("combobox", { name: "Azure subscription" });
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    const row = (await screen.findByText("legacy")).closest("tr")!;
    expect(within(row).getByText(/not Microsoft Entra ID/)).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("says what an import needs and shows scan errors", async () => {
    vi.mocked(cloudDiscoveryApi.scanAks).mockResolvedValueOnce({ clusters: [], errors: [{ region: "", message: "this account isn't allowed to read AKS clusters here" }] });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find AKS clusters" }));
    expect(await screen.findByText(/kubelogin/)).toBeInTheDocument();
    fireEvent.change(await screen.findByRole("combobox", { name: "Azure subscription" }), { target: { value: "2b2b2b2b-0000-0000-0000-000000000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText(/isn't allowed to read AKS clusters/)).toBeInTheDocument();
  });

  it("shows why subscriptions couldn't be listed", async () => {
    vi.mocked(cloudDiscoveryApi.azureSubscriptions).mockRejectedValueOnce(new Error("az CLI not found on PATH: install the Azure CLI"));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find AKS clusters" }));
    expect(await screen.findByText(/install the Azure CLI/)).toBeInTheDocument();
  });
});
