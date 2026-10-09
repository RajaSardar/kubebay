import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConfigurePrometheusModal from "../ConfigurePrometheusModal";
import * as api from "../../lib/api";

vi.mock("../../lib/api");

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn(),
}));

const { useResourceStream } = await import("../../lib/useResourceStream");

describe("ConfigurePrometheusModal", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
  });

  function renderModal(onClose = vi.fn(), onSaved = vi.fn()) {
    return render(
      <QueryClientProvider client={qc}>
        <ConfigurePrometheusModal cluster="kind-test" onClose={onClose} onSaved={onSaved} />
      </QueryClientProvider>
    );
  }

  it("displays heading with cluster name", () => {
    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal();
    expect(screen.getByRole("dialog", { name: /Configure Prometheus for kind-test/i })).toBeTruthy();
  });

  it("shows spinner when services are loading", () => {
    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: false, connected: true });
    renderModal();
    expect(screen.getByRole("status")).toBeTruthy(); // Spinner role
  });

  it("renders candidate cards when services are available", () => {
    const services = [
      {
        metadata: { name: "prometheus-server", namespace: "monitoring", labels: {} },
        spec: { ports: [{ port: 9090 }] },
      },
    ];
    vi.mocked(useResourceStream).mockReturnValue({ rows: services, synced: true, connected: true });
    renderModal();
    expect(screen.getByText(/prometheus-server/i)).toBeTruthy();
    expect(screen.getByText(/monitoring/i)).toBeTruthy();
  });

  it("selects a candidate and pre-fills URL with localhost port", async () => {
    const user = userEvent.setup();
    const services = [
      {
        metadata: { name: "prometheus-server", namespace: "monitoring", labels: {} },
        spec: { ports: [{ port: 9090 }] },
      },
    ];
    vi.mocked(useResourceStream).mockReturnValue({ rows: services, synced: true, connected: true });
    renderModal();

    const candidateCard = screen.getByRole("button", { name: /prometheus-server/ });
    await user.click(candidateCard);

    const urlField = screen.getByDisplayValue(/http:\/\/localhost:9090/);
    expect(urlField).toBeTruthy();
  });

  it("shows port-forward command when candidate is selected", async () => {
    const user = userEvent.setup();
    const services = [
      {
        metadata: { name: "prometheus-server", namespace: "monitoring", labels: {} },
        spec: { ports: [{ port: 9090 }] },
      },
    ];
    vi.mocked(useResourceStream).mockReturnValue({ rows: services, synced: true, connected: true });
    renderModal();

    const candidateCard = screen.getByRole("button", { name: /prometheus-server/ });
    await user.click(candidateCard);

    expect(screen.getByText(/kubectl -n monitoring port-forward svc\/prometheus-server 9090:9090/)).toBeTruthy();
  });

  it("offers a Manual card beside discovered services", () => {
    const services = [{ metadata: { name: "prometheus-server", namespace: "monitoring", labels: {} }, spec: { ports: [{ port: 9090 }] } }];
    vi.mocked(useResourceStream).mockReturnValue({ rows: services, synced: true, connected: true });
    renderModal();
    expect(screen.getByRole("button", { name: /Manual/ })).toBeTruthy();
  });

  it("clears URL field when Manual is selected", async () => {
    const user = userEvent.setup();
    const services = [
      {
        metadata: { name: "prometheus-server", namespace: "monitoring", labels: {} },
        spec: { ports: [{ port: 9090 }] },
      },
    ];
    vi.mocked(useResourceStream).mockReturnValue({ rows: services, synced: true, connected: true });
    renderModal();

    // Select candidate first
    const candidateCard = screen.getByRole("button", { name: /prometheus-server/ });
    await user.click(candidateCard);
    expect(screen.getByDisplayValue(/http:\/\/localhost:9090/)).toBeTruthy();

    // Then select Manual
    const manualCard = screen.getByRole("button", { name: /Manual/ });
    await user.click(manualCard);

    // URL field should be empty
    const urlField = screen.getByRole("textbox", { name: /URL/i }) as HTMLInputElement;
    expect(urlField.value).toBe("");
  });

  it("disables Save button when URL is empty", () => {
    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal();

    const saveBtn = screen.getByRole("button", { name: /Save/ });
    expect(saveBtn).toHaveProperty("disabled", true);
  });

  it("enables Save button when URL is filled", async () => {
    const user = userEvent.setup();
    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal();

    const urlField = screen.getByRole("textbox", { name: /URL/i });
    await user.type(urlField, "http://localhost:9090");

    const saveBtn = screen.getByRole("button", { name: /Save/ });
    expect(saveBtn).toHaveProperty("disabled", false);
  });

  it("calls settingsApi.save with per-cluster URL and preserves global URL", async () => {
    const user = userEvent.setup();
    const mockGet = vi.mocked(api.settingsApi.get);
    const mockSave = vi.mocked(api.settingsApi.save);

    mockGet.mockResolvedValue({ prometheusUrl: "http://global:9090", prometheusUrls: { "other-cluster": "http://other:9090" }, extraKubeconfigs: [] });
    mockSave.mockResolvedValue({ ok: true, saved: { extraKubeconfigs: [] } });

    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal();

    const urlField = screen.getByRole("textbox", { name: /URL/i });
    await user.type(urlField, "http://localhost:9090");

    const saveBtn = screen.getByRole("button", { name: /Save/ });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith({
        prometheusUrl: "http://global:9090",
        prometheusUrls: { "other-cluster": "http://other:9090", "kind-test": "http://localhost:9090" },
        extraKubeconfigs: [],
      });
    });
  });

  it("keeps every other stored setting when saving -- the engine replaces extraKubeconfigs/onlyListed wholesale", async () => {
    const user = userEvent.setup();
    const mockGet = vi.mocked(api.settingsApi.get);
    const mockSave = vi.mocked(api.settingsApi.save);

    mockGet.mockResolvedValue({
      prometheusUrl: "",
      prometheusUrls: {},
      extraKubeconfigs: ["/home/me/.kube/staging.yaml"],
      onlyListedKubeconfigs: true,
      nodeShellImage: "alpine:3.20",
    });
    mockSave.mockResolvedValue({ ok: true, saved: { prometheusUrl: "", prometheusUrls: {}, extraKubeconfigs: [] } });

    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal();

    await user.type(screen.getByRole("textbox", { name: /URL/i }), "http://localhost:9090");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          extraKubeconfigs: ["/home/me/.kube/staging.yaml"],
          onlyListedKubeconfigs: true,
          nodeShellImage: "alpine:3.20",
          prometheusUrls: { "kind-test": "http://localhost:9090" },
        }),
      );
    });
  });

  it("calls onSaved and onClose after successful save", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();

    const mockGet = vi.mocked(api.settingsApi.get);
    const mockSave = vi.mocked(api.settingsApi.save);

    mockGet.mockResolvedValue({ prometheusUrl: "", prometheusUrls: {}, extraKubeconfigs: [] });
    mockSave.mockResolvedValue({ ok: true, saved: { extraKubeconfigs: [] } });

    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal(onClose, onSaved);

    const urlField = screen.getByRole("textbox", { name: /URL/i });
    await user.type(urlField, "http://localhost:9090");

    const saveBtn = screen.getByRole("button", { name: /Save/ });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows error banner when save fails", async () => {
    const user = userEvent.setup();

    const mockGet = vi.mocked(api.settingsApi.get);
    const mockSave = vi.mocked(api.settingsApi.save);

    mockGet.mockResolvedValue({ prometheusUrl: "", prometheusUrls: {}, extraKubeconfigs: [] });
    mockSave.mockRejectedValue(new Error("Save failed"));

    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal();

    const urlField = screen.getByRole("textbox", { name: /URL/i });
    await user.type(urlField, "http://localhost:9090");

    const saveBtn = screen.getByRole("button", { name: /Save/ });
    await user.click(saveBtn);

    // The engine's own reason, not a generic "failed".
    expect(await screen.findByText("Couldn't save: Save failed")).toBeTruthy();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal(onClose);

    const cancelBtn = screen.getByRole("button", { name: /Cancel/ });
    await user.click(cancelBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onSaved when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal(vi.fn(), onSaved);

    const cancelBtn = screen.getByRole("button", { name: /Cancel/ });
    await user.click(cancelBtn);

    expect(onSaved).not.toHaveBeenCalled();
  });

  describe("works before, without and beyond discovery", () => {
    const stream = (rows: unknown[], synced = true) =>
      vi.mocked(useResourceStream).mockReturnValue({ rows, synced, connected: true } as never);
    const svc = (name: string, port: number, ns = "monitoring") => ({ metadata: { name, namespace: ns, labels: {} }, spec: { ports: [{ port }] } });

    it("keeps the URL field, Cancel and Save while discovery is still loading", () => {
      stream([], false);
      renderModal();
      expect(screen.getByRole("textbox", { name: /URL/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.getByText("Looking for Prometheus services…")).toBeTruthy();
    });

    it("does not connect to a cluster that isn't connected just to look for services", () => {
      stream([]);
      render(
        <QueryClientProvider client={qc}>
          <ConfigurePrometheusModal cluster="kind-test" connected={false} onClose={vi.fn()} onSaved={vi.fn()} />
        </QueryClientProvider>,
      );
      expect(vi.mocked(useResourceStream)).toHaveBeenCalledWith("kind-test", "v1/services", expect.objectContaining({ enabled: false }));
      expect(screen.getByText("Connect to this cluster to look for its Prometheus services.")).toBeTruthy();
      expect(screen.getByRole("textbox", { name: /URL/i })).toBeTruthy();
    });

    it("says so when the cluster has no Prometheus services", () => {
      stream([svc("checkout", 8080)]);
      renderModal();
      expect(screen.getByText("No Prometheus services found in this cluster.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Manual/ })).toBeNull();
    });

    it("shows Prometheus itself first, not Grafana or the exporters, at most four", () => {
      stream([
        svc("kube-prometheus-stack-grafana", 80),
        svc("kube-prometheus-stack-alertmanager", 9093),
        svc("kube-prometheus-stack-prometheus-node-exporter", 9100),
        svc("kube-prometheus-stack-prometheus", 9090),
      ]);
      renderModal();
      const cards = screen.getAllByRole("button", { pressed: false }).map((b) => b.textContent ?? "");
      expect(cards[0]).toContain("kube-prometheus-stack-prometheus");
      expect(cards.some((t) => t.includes("grafana") || t.includes("alertmanager") || t.includes("exporter"))).toBe(false);
    });

    it("cards are the design system's choice cards, marked when chosen", async () => {
      const user = userEvent.setup();
      stream([svc("prometheus-server", 9090)]);
      renderModal();
      const card = screen.getByRole("button", { name: /prometheus-server/ });
      expect(card).toHaveAttribute("aria-pressed", "false");
      await user.click(card);
      expect(card).toHaveAttribute("aria-pressed", "true");
      expect(card).toHaveClass("kb-choice-card");
    });

    it("suggests a port a laptop can bind for a service on port 80", async () => {
      const user = userEvent.setup();
      stream([svc("prometheus-server", 80)]);
      renderModal();
      await user.click(screen.getByRole("button", { name: /prometheus-server/ }));
      expect(screen.getByDisplayValue("http://localhost:9090")).toBeTruthy();
      expect(screen.getByText("kubectl -n monitoring port-forward svc/prometheus-server 9090:80")).toBeTruthy();
    });

    it("shows the cluster's current URL, and saving it empty goes back to the default", async () => {
      const user = userEvent.setup();
      vi.mocked(api.settingsApi.get).mockResolvedValue({
        prometheusUrl: "http://default:9090",
        prometheusUrls: { "kind-test": "http://localhost:9091", other: "http://other:9090" },
        extraKubeconfigs: [],
      });
      vi.mocked(api.settingsApi.save).mockResolvedValue({ ok: true, saved: { extraKubeconfigs: [] } } as never);
      stream([]);
      renderModal();
      const field = await screen.findByDisplayValue("http://localhost:9091");
      expect(field).toHaveAttribute("placeholder", "http://default:9090");
      expect(screen.getByText("Leave it empty to use the default.")).toBeTruthy();
      await user.clear(field);
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(api.settingsApi.save).toHaveBeenCalledWith(expect.objectContaining({ prometheusUrls: { other: "http://other:9090" } })),
      );
    });

    it("keeps Save off when the field is empty and there is nothing to remove", async () => {
      vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "", prometheusUrls: {}, extraKubeconfigs: [] });
      stream([]);
      renderModal();
      await waitFor(() => expect(api.settingsApi.get).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    });

    it("saves on Enter", async () => {
      const user = userEvent.setup();
      vi.mocked(api.settingsApi.get).mockResolvedValue({ prometheusUrl: "", prometheusUrls: {}, extraKubeconfigs: [] });
      vi.mocked(api.settingsApi.save).mockResolvedValue({ ok: true, saved: { extraKubeconfigs: [] } } as never);
      stream([]);
      renderModal();
      await user.type(screen.getByRole("textbox", { name: /URL/i }), "http://localhost:9090{Enter}");
      await waitFor(() =>
        expect(api.settingsApi.save).toHaveBeenCalledWith(expect.objectContaining({ prometheusUrls: { "kind-test": "http://localhost:9090" } })),
      );
    });

    it("is a wide dialog, room for a URL and a port-forward command", () => {
      stream([]);
      renderModal();
      expect(screen.getByRole("dialog", { name: /Configure Prometheus for kind-test/ })).toHaveClass("wide");
    });
  });
});
