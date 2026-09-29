import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { helmMarketApi, helmApi } from "../lib/api";
import { InstallVpaRecommender } from "./InstallVpaRecommender";

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
  "metadata:\n  name: vpa-recommender",
  "---",
  "apiVersion: apps/v1",
  "kind: Deployment",
  "metadata:\n  name: vpa-recommender",
].join("\n");

describe("InstallVpaRecommender", () => {
  beforeEach(() => {
    vi.mocked(helmMarketApi.addRepo).mockReset().mockResolvedValue({ name: "autoscaler", url: "https://kubernetes.github.io/autoscaler" });
    vi.mocked(helmApi.upgrade).mockReset();
  });

  it("shows an install button and nothing else initially", () => {
    render(<InstallVpaRecommender cluster="kind-a" />);
    expect(screen.getByRole("button", { name: /install vpa recommender/i })).toBeTruthy();
    expect(screen.queryByText(/ServiceAccount/)).toBeNull();
  });

  it("previews via a client-side dry run before installing anything", async () => {
    vi.mocked(helmApi.upgrade).mockResolvedValue({
      name: "kubebay-vpa-recommender",
      namespace: "kube-system",
      chart: "vertical-pod-autoscaler",
      chartVersion: "0.1.0",
      status: "pending-install",
      revision: 1,
      manifest,
    });

    render(<InstallVpaRecommender cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install vpa recommender/i }));

    await waitFor(() => expect(helmMarketApi.addRepo).toHaveBeenCalled());
    expect(helmApi.upgrade).toHaveBeenCalledWith(
      expect.objectContaining({ cluster: "kind-a", dryRun: true }),
    );
    await waitFor(() => expect(screen.getByText("ServiceAccount")).toBeTruthy());
    expect(screen.getByText("Deployment")).toBeTruthy();
  });

  it("surfaces the observe-only, updateMode Off, and not-production-ready caveats once previewed", async () => {
    vi.mocked(helmApi.upgrade).mockResolvedValue({
      name: "kubebay-vpa-recommender",
      namespace: "kube-system",
      chart: "vertical-pod-autoscaler",
      chartVersion: "0.1.0",
      status: "pending-install",
      revision: 1,
      manifest,
    });
    render(<InstallVpaRecommender cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install vpa recommender/i }));

    await waitFor(() => expect(screen.getByText(/updateMode.*Off/i)).toBeTruthy());
    expect(screen.getByText(/not.*production/i)).toBeTruthy();
  });

  it("gates the real install behind typing the exact confirm phrase", async () => {
    vi.mocked(helmApi.upgrade).mockResolvedValue({
      name: "kubebay-vpa-recommender",
      namespace: "kube-system",
      chart: "vertical-pod-autoscaler",
      chartVersion: "0.1.0",
      status: "pending-install",
      revision: 1,
      manifest,
    });
    render(<InstallVpaRecommender cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install vpa recommender/i }));
    await waitFor(() => expect(screen.getByText("ServiceAccount")).toBeTruthy());

    const confirmButton = screen.getByRole("button", { name: /^install$/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/install/i), { target: { value: "install" } });
    expect(confirmButton).not.toBeDisabled();
  });

  it("installs for real (dryRun false) only after the confirm phrase is typed", async () => {
    vi.mocked(helmApi.upgrade)
      .mockResolvedValueOnce({
        name: "kubebay-vpa-recommender",
        namespace: "kube-system",
        chart: "vertical-pod-autoscaler",
        chartVersion: "0.1.0",
        status: "pending-install",
        revision: 1,
        manifest,
      })
      .mockResolvedValueOnce({
        name: "kubebay-vpa-recommender",
        namespace: "kube-system",
        chart: "vertical-pod-autoscaler",
        chartVersion: "0.1.0",
        status: "deployed",
        revision: 1,
      });

    render(<InstallVpaRecommender cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install vpa recommender/i }));
    await waitFor(() => expect(screen.getByText("ServiceAccount")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/install/i), { target: { value: "install" } });
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

    await waitFor(() =>
      expect(helmApi.upgrade).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false })),
    );
    await waitFor(() => expect(screen.getByText(/deployed/i)).toBeTruthy());
  });

  it("shows an error if the preview fails", async () => {
    vi.mocked(helmApi.upgrade).mockRejectedValue(new Error("locate chart: not found"));
    render(<InstallVpaRecommender cluster="kind-a" />);
    fireEvent.click(screen.getByRole("button", { name: /install vpa recommender/i }));

    await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy());
  });
});
