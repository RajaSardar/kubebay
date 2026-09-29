import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { helmMarketApi, helmApi } from "../lib/api";
import { InstallTrivyOperator } from "./InstallTrivyOperator";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    helmMarketApi: { ...actual.helmMarketApi, addRepo: vi.fn() },
    helmApi: { ...actual.helmApi, upgrade: vi.fn() },
  };
});

const manifest = [
  "apiVersion: v1",
  "kind: ServiceAccount",
  "metadata:\n  name: trivy-operator",
  "---",
  "apiVersion: apps/v1",
  "kind: Deployment",
  "metadata:\n  name: trivy-operator",
].join("\n");

describe("InstallTrivyOperator", () => {
  beforeEach(() => {
    vi.mocked(helmMarketApi.addRepo).mockReset().mockResolvedValue({ name: "aqua", url: "https://aquasecurity.github.io/helm-charts/" });
    vi.mocked(helmApi.upgrade).mockReset();
  });

  it("shows an install button and nothing else initially", () => {
    render(<InstallTrivyOperator cluster="kind-a" />);
    expect(screen.getByRole("button", { name: /install trivy-operator/i })).toBeTruthy();
    expect(screen.queryByText(/ServiceAccount/)).toBeNull();
  });

  it("previews via a client-side dry run before installing anything", async () => {
    vi.mocked(helmApi.upgrade).mockResolvedValue({
      name: "kubebay-trivy-operator",
      namespace: "trivy-system",
      chart: "trivy-operator",
      chartVersion: "0.36.0",
      status: "pending-install",
      revision: 1,
      manifest,
    });

    render(<InstallTrivyOperator cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install trivy-operator/i }));

    await waitFor(() => expect(helmMarketApi.addRepo).toHaveBeenCalled());
    expect(helmApi.upgrade).toHaveBeenCalledWith(expect.objectContaining({ cluster: "kind-a", dryRun: true }));
    await waitFor(() => expect(screen.getByText("ServiceAccount")).toBeTruthy());
    expect(screen.getByText("Deployment")).toBeTruthy();
  });

  it("only enables the vulnerability scanner, and states so once previewed", async () => {
    vi.mocked(helmApi.upgrade).mockResolvedValue({
      name: "kubebay-trivy-operator",
      namespace: "trivy-system",
      chart: "trivy-operator",
      chartVersion: "0.36.0",
      status: "pending-install",
      revision: 1,
      manifest,
    });
    render(<InstallTrivyOperator cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install trivy-operator/i }));

    await waitFor(() =>
      expect(helmApi.upgrade).toHaveBeenCalledWith(expect.objectContaining({ valuesYaml: expect.stringContaining("vulnerabilityScannerEnabled: true") })),
    );
    expect(helmApi.upgrade).toHaveBeenCalledWith(expect.objectContaining({ valuesYaml: expect.stringContaining("configAuditScannerEnabled: false") }));
    await waitFor(() => expect(screen.getByText(/only the vulnerability scanner/i)).toBeTruthy());
  });

  it("gates the real install behind typing the exact confirm phrase", async () => {
    vi.mocked(helmApi.upgrade).mockResolvedValue({
      name: "kubebay-trivy-operator",
      namespace: "trivy-system",
      chart: "trivy-operator",
      chartVersion: "0.36.0",
      status: "pending-install",
      revision: 1,
      manifest,
    });
    render(<InstallTrivyOperator cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install trivy-operator/i }));
    await waitFor(() => expect(screen.getByText("ServiceAccount")).toBeTruthy());

    const confirmButton = screen.getByRole("button", { name: /^install$/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/install/i), { target: { value: "install" } });
    expect(confirmButton).not.toBeDisabled();
  });

  it("installs for real (dryRun false) only after the confirm phrase is typed", async () => {
    vi.mocked(helmApi.upgrade)
      .mockResolvedValueOnce({
        name: "kubebay-trivy-operator",
        namespace: "trivy-system",
        chart: "trivy-operator",
        chartVersion: "0.36.0",
        status: "pending-install",
        revision: 1,
        manifest,
      })
      .mockResolvedValueOnce({
        name: "kubebay-trivy-operator",
        namespace: "trivy-system",
        chart: "trivy-operator",
        chartVersion: "0.36.0",
        status: "deployed",
        revision: 1,
      });

    render(<InstallTrivyOperator cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install trivy-operator/i }));
    await waitFor(() => expect(screen.getByText("ServiceAccount")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/install/i), { target: { value: "install" } });
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

    await waitFor(() => expect(helmApi.upgrade).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false })));
    await waitFor(() => expect(screen.getByText(/deployed/i)).toBeTruthy());
  });

  it("shows an error if the preview fails", async () => {
    vi.mocked(helmApi.upgrade).mockRejectedValue(new Error("locate chart: not found"));
    render(<InstallTrivyOperator cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install trivy-operator/i }));

    await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy());
  });
});
