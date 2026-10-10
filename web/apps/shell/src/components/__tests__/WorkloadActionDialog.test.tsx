import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkloadActionDialog, workloadActions } from "../WorkloadActionDialog";
import { api } from "../../lib/api";
import { PolicyRejectionError } from "../../lib/policyRejection";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, scale: vi.fn(), restart: vi.fn() } };
});

const deploy = (replicas: number, annotations: Record<string, string> = {}) => ({
  metadata: { name: "web", namespace: "shop", annotations },
  spec: { replicas },
});

describe("workloadActions", () => {
  it.each([
    ["deployments", { scale: true, restart: true }],
    ["statefulsets", { scale: true, restart: true }],
    ["daemonsets", { scale: false, restart: true }],
    ["configmaps", { scale: false, restart: false }],
  ])("%s rows offer %o", (slug, want) => {
    expect(workloadActions(slug)).toEqual(want);
  });
});

describe("WorkloadActionDialog — scale", () => {
  beforeEach(() => vi.mocked(api.scale).mockReset());

  it("starts at the current replica count and applies the new one", async () => {
    vi.mocked(api.scale).mockResolvedValueOnce({ ok: true });
    const onClose = vi.fn();
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Scale web" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scale web" })).toBeInTheDocument();
    const field = screen.getByLabelText("Replicas") as HTMLInputElement;
    expect(field.value).toBe("3");
    fireEvent.change(field, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.scale).toHaveBeenCalledWith({ cluster: "kind-shop", gvr: "apps/v1/deployments", ns: "shop", name: "web", replicas: 5, gitopsOwner: undefined });
  });

  it("cannot apply an empty or unchanged count", () => {
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={() => {}} />);
    const apply = screen.getByRole("button", { name: "Scale" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Replicas"), { target: { value: "" } });
    expect(apply).toBeDisabled();
  });

  it("warns when a GitOps controller owns the workload, and tells the engine who", async () => {
    vi.mocked(api.scale).mockResolvedValueOnce({ ok: true });
    render(
      <WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(2, { "argocd.argoproj.io/instance": "shop-app" })} onClose={() => {}} />,
    );
    expect(screen.getByText(/Argo CD \(shop-app\) manages this resource/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Replicas"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() => expect(api.scale).toHaveBeenCalledWith(expect.objectContaining({ gitopsOwner: "Argo CD: shop-app" })));
  });

  it("stays open and shows a policy rejection as a card", async () => {
    vi.mocked(api.scale).mockRejectedValueOnce(new PolicyRejectionError({ engine: "kyverno", webhook: "w", message: "max 10 replicas" }));
    const onClose = vi.fn();
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Replicas"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    expect(await screen.findByText(/max 10 replicas/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("WorkloadActionDialog — restart", () => {
  beforeEach(() => vi.mocked(api.restart).mockReset());

  it("asks first, then restarts the rollout", async () => {
    vi.mocked(api.restart).mockResolvedValueOnce({ ok: true });
    const onClose = vi.fn();
    render(<WorkloadActionDialog action="restart" slug="statefulsets" cluster="kind-shop" obj={deploy(3)} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Restart web?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Restart web?" })).toBeInTheDocument();
    expect(api.restart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.restart).toHaveBeenCalledWith({ cluster: "kind-shop", gvr: "apps/v1/statefulsets", ns: "shop", name: "web", gitopsOwner: undefined });
  });

  it("stays open with the error when the restart fails", async () => {
    vi.mocked(api.restart).mockRejectedValueOnce(new Error("forbidden: cannot patch"));
    const onClose = vi.fn();
    render(<WorkloadActionDialog action="restart" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(await screen.findByText(/forbidden: cannot patch/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel closes without acting", () => {
    const onClose = vi.fn();
    render(<WorkloadActionDialog action="restart" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(api.restart).not.toHaveBeenCalled();
  });
});
