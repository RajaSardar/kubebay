import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ClusterPicker from "../ClusterPicker";
import * as api from "../../lib/api";

// Kubeconfig files are managed where the clusters are: the cluster list has
// "Add kubeconfig", and each cluster's own settings (its Prometheus URL) sit
// in that cluster's details.

vi.mock("../../lib/api");
vi.mock("../../components/ConfigurePrometheusModal", () => ({
  default: ({ cluster, onClose }: { cluster: string; onClose: () => void }) => (
    <div role="dialog" aria-label={`Configure Prometheus for ${cluster}`}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const kind = { id: "kind-shop", context: "kind-shop", server: "https://127.0.0.1:6443", status: "connected" } as api.ClusterInfo;


function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/clusters" element={<ClusterPicker />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("kubeconfig on the cluster list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api.api.clusters).mockResolvedValue([kind]);
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "http://default:9090", prometheusUrls: {}, extraKubeconfigs: [], activeKubeconfigs: ["/home/me/.kube/config"] });
    vi.mocked(api.settingsApi.save).mockResolvedValue(undefined as never);
  });

  it("adds a kubeconfig file from the cluster list", async () => {
    renderAt("/clusters");
    fireEvent.click(await screen.findByRole("button", { name: "Add kubeconfig" }));
    const dialog = screen.getByRole("dialog", { name: "Kubeconfig sources" });
    expect(await within(dialog).findByText("/home/me/.kube/config")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Kubeconfig file path" }), { target: { value: "/tmp/other.yaml" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add file" }));
    await waitFor(() => expect(api.settingsApi.save).toHaveBeenCalledWith(expect.objectContaining({ extraKubeconfigs: ["/tmp/other.yaml"] })));
  });

  it("opens the kubeconfig dialog from a link (?kubeconfig=1)", async () => {
    renderAt("/clusters?kubeconfig=1");
    expect(await screen.findByRole("dialog", { name: "Kubeconfig sources" })).toBeInTheDocument();
  });

  it("offers it when no clusters were found", async () => {
    vi.mocked(api.api.clusters).mockResolvedValue([]);
    renderAt("/clusters");
    expect(await screen.findByText("No clusters found in kubeconfig.")).toBeInTheDocument();
    expect(screen.getByText("Add a kubeconfig file to see its clusters.")).toBeInTheDocument();
  });

  it("each cluster's details show its Prometheus URL and configure it there", async () => {
    vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "http://default:9090", prometheusUrls: { "kind-shop": "http://localhost:9091" }, extraKubeconfigs: [] });
    renderAt("/clusters");
    fireEvent.click((await screen.findAllByText("kind-shop"))[0]!.closest("tr")!);
    const settings = await screen.findByRole("region", { name: "Settings for this cluster" });
    expect(await within(settings).findByText("http://localhost:9091")).toBeInTheDocument();
    fireEvent.click(within(settings).getByRole("button", { name: "Configure Prometheus" }));
    expect(screen.getByRole("dialog", { name: "Configure Prometheus for kind-shop" })).toBeInTheDocument();
  });
});
