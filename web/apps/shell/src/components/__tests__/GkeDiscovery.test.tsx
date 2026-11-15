import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GkeDiscovery } from "../GkeDiscovery";
import { cloudDiscoveryApi } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  cloudDiscoveryApi: { gcpProjects: vi.fn(), scanGke: vi.fn(), importGke: vi.fn() },
}));

const cluster = (name: string, imported = false) => ({
  project: "shop-prod",
  location: "europe-west1",
  name,
  context: `gke_shop-prod_europe-west1_${name}`,
  endpoint: "34.1.2.3",
  status: "RUNNING",
  version: "1.31.1-gke.100",
  imported,
});

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GkeDiscovery />
    </QueryClientProvider>,
  );
}

describe("GkeDiscovery (backlog #14)", () => {
  beforeEach(() => {
    vi.mocked(cloudDiscoveryApi.gcpProjects).mockReset().mockResolvedValue([
      { id: "ml-sandbox", name: "ML sandbox" },
      { id: "shop-prod", name: "Shop prod", default: true },
    ]);
    vi.mocked(cloudDiscoveryApi.scanGke).mockReset().mockResolvedValue({ clusters: [cluster("web"), cluster("batch", true)], errors: [] });
    vi.mocked(cloudDiscoveryApi.importGke).mockReset().mockResolvedValue({ path: "/home/me/.kubebay/discovered/gke-shop-prod-europe-west1-web.yaml", context: cluster("web").context });
  });

  it("runs nothing until asked", () => {
    renderIt();
    expect(screen.getByRole("button", { name: "Find GKE clusters" })).toBeInTheDocument();
    expect(cloudDiscoveryApi.gcpProjects).not.toHaveBeenCalled();
  });

  it("scans gcloud's default project and imports a cluster", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find GKE clusters" }));
    const select = await screen.findByRole("combobox", { name: "Google Cloud project" });
    await waitFor(() => expect(select).toHaveValue("shop-prod"));
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(cloudDiscoveryApi.scanGke).toHaveBeenCalledWith("shop-prod"));
    expect(await screen.findByText("web")).toBeInTheDocument();
    expect(screen.getByText("in your kubeconfig")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(cloudDiscoveryApi.importGke).toHaveBeenCalledWith("shop-prod", "europe-west1", "web"));
    expect(await screen.findByText("imported")).toBeInTheDocument();
  });

  it("says what each import needs and shows scan errors", async () => {
    vi.mocked(cloudDiscoveryApi.scanGke).mockResolvedValueOnce({ clusters: [], errors: [{ region: "", message: "the Kubernetes Engine API isn't enabled in this project" }] });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find GKE clusters" }));
    expect(await screen.findByText(/gke-gcloud-auth-plugin/)).toBeInTheDocument();
    fireEvent.change(await screen.findByRole("combobox", { name: "Google Cloud project" }), { target: { value: "ml-sandbox" } });
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText(/Kubernetes Engine API isn't enabled/)).toBeInTheDocument();
    expect(cloudDiscoveryApi.scanGke).toHaveBeenCalledWith("ml-sandbox");
  });

  it("shows why projects couldn't be listed", async () => {
    vi.mocked(cloudDiscoveryApi.gcpProjects).mockRejectedValueOnce(new Error("gcloud CLI not found on PATH: install the Google Cloud CLI"));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find GKE clusters" }));
    expect(await screen.findByText(/install the Google Cloud CLI/)).toBeInTheDocument();
  });
});
