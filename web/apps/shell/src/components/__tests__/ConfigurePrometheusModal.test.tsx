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

  it("renders manual option card", () => {
    vi.mocked(useResourceStream).mockReturnValue({ rows: [], synced: true, connected: true });
    renderModal();
    expect(screen.getByText(/Manual/i)).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByText(/Failed to save/i)).toBeTruthy();
    });
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
});
