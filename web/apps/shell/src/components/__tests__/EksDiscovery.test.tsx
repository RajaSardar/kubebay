import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EksDiscovery } from "../EksDiscovery";
import { cloudDiscoveryApi } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  cloudDiscoveryApi: { profiles: vi.fn(), scan: vi.fn(), importEks: vi.fn() },
}));

const cluster = (name: string, imported = false) => ({
  region: "eu-west-1",
  name,
  arn: `arn:aws:eks:eu-west-1:111122223333:cluster/${name}`,
  account: "111122223333",
  endpoint: `https://${name}.example`,
  status: "ACTIVE",
  version: "1.31",
  imported,
});

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EksDiscovery />
    </QueryClientProvider>,
  );
}

describe("EksDiscovery (backlog #14)", () => {
  beforeEach(() => {
    vi.mocked(cloudDiscoveryApi.profiles).mockReset().mockResolvedValue([
      { name: "default", region: "us-east-1" },
      { name: "work", region: "eu-west-1" },
    ]);
    vi.mocked(cloudDiscoveryApi.scan).mockReset().mockResolvedValue({ clusters: [cluster("dev"), cluster("prod", true)], errors: [] });
    vi.mocked(cloudDiscoveryApi.importEks).mockReset().mockResolvedValue({ path: "/home/me/.kubebay/discovered/eks-work-eu-west-1-dev.yaml", context: cluster("dev").arn });
  });

  it("runs nothing until asked, since every call runs the aws CLI", () => {
    renderIt();
    expect(cloudDiscoveryApi.profiles).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Find EKS clusters" })).toBeInTheDocument();
  });

  it("scans the chosen profile's regions and imports a cluster", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find EKS clusters" }));
    const profile = await screen.findByLabelText("AWS profile");
    fireEvent.change(profile, { target: { value: "work" } });
    expect(screen.getByLabelText("AWS regions")).toHaveValue("eu-west-1");
    fireEvent.change(screen.getByLabelText("AWS regions"), { target: { value: "eu-west-1, us-east-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText("dev")).toBeInTheDocument();
    expect(cloudDiscoveryApi.scan).toHaveBeenCalledWith("work", ["eu-west-1", "us-east-1"]);
    // prod is already in a kubeconfig: no import offered.
    const prodRow = screen.getByText("prod").closest("tr")!;
    expect(within(prodRow).getByText("in your kubeconfig")).toBeInTheDocument();
    expect(within(prodRow).queryByRole("button")).toBeNull();
    fireEvent.click(within(screen.getByText("dev").closest("tr")!).getByRole("button", { name: "Import" }));
    expect(await screen.findByText("imported")).toBeInTheDocument();
    expect(cloudDiscoveryApi.importEks).toHaveBeenCalledWith("work", "eu-west-1", "dev");
  });

  it("lists regions that couldn't be read alongside the clusters that could", async () => {
    vi.mocked(cloudDiscoveryApi.scan).mockResolvedValue({
      clusters: [cluster("dev")],
      errors: [{ region: "ap-east-1", message: "this region is not enabled for the account, or the credentials aren't valid in it" }],
    });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find EKS clusters" }));
    await screen.findByLabelText("AWS profile");
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText(/ap-east-1: this region is not enabled/)).toBeInTheDocument();
    expect(screen.getByText("dev")).toBeInTheDocument();
  });

  it("explains when discovery isn't available", async () => {
    vi.mocked(cloudDiscoveryApi.profiles).mockRejectedValue(new Error("cluster discovery runs the aws CLI with the engine host's own credentials, so it is off when OIDC is configured"));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Find EKS clusters" }));
    expect(await screen.findByText(/off when OIDC is configured/)).toBeInTheDocument();
  });
});
