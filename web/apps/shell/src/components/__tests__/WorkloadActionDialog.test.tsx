import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkloadActionDialog, workloadActions } from "../WorkloadActionDialog";
import { api } from "../../lib/api";
import { PolicyRejectionError } from "../../lib/policyRejection";

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: () => ({ rows: [], synced: true, connected: true }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, scale: vi.fn(), restart: vi.fn() } };
});

const deploy = (replicas: number, annotations: Record<string, string> = {}) => ({
  metadata: { name: "web", namespace: "shop", annotations },
  spec: { replicas },
});

/** The Scale dialog shows the replica controls in place (no popover). */
const field = () => screen.getByRole("spinbutton", { name: "Replicas" }) as HTMLInputElement;
const bump = (d: number) => fireEvent.change(field(), { target: { value: String(Number(field().value) + d) } });

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

describe("WorkloadActionDialog — replica control (backlog #5, #89)", () => {
  beforeEach(() => vi.mocked(api.scale).mockReset());

  it("shows the number box, slider and chips in place with the current count", () => {
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Decrease replicas" })).toBeNull();
    expect(screen.getByRole("slider", { name: "Replicas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Current (3)" })).toBeInTheDocument();
    expect(field()).toHaveValue(3);
  });

  it("+ increments the count and enables Scale", () => {
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={() => {}} />);
    bump(1);
    expect(field()).toHaveValue(4);
    expect(screen.getByRole("button", { name: "Scale" })).not.toBeDisabled();
  });

  it("− decrements the count and enables Scale", () => {
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={() => {}} />);
    bump(-1);
    expect(field()).toHaveValue(2);
    expect(screen.getByRole("button", { name: "Scale" })).not.toBeDisabled();
  });

  it("never goes below 0", () => {
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(0)} onClose={() => {}} />);
    bump(-1);
    expect(field()).toHaveValue(0);
    expect(screen.getByRole("button", { name: "Scale" })).toBeDisabled();
  });

  it("Scale is disabled when count is unchanged", () => {
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Scale" })).toBeDisabled();
  });

  it("applies the new count and closes", async () => {
    vi.mocked(api.scale).mockResolvedValueOnce({ ok: true });
    const onClose = vi.fn();
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Scale web" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scale web" })).toBeInTheDocument();
    bump(1);
    bump(1);
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.scale).toHaveBeenCalledWith({ cluster: "kind-shop", gvr: "apps/v1/deployments", ns: "shop", name: "web", replicas: 5, gitopsOwner: undefined });
  });

  it("warns when a GitOps controller owns the workload, and tells the engine who", async () => {
    vi.mocked(api.scale).mockResolvedValueOnce({ ok: true });
    render(
      <WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(2, { "argocd.argoproj.io/instance": "shop-app" })} onClose={() => {}} />,
    );
    expect(screen.getByText(/Argo CD \(shop-app\) manages this resource/)).toBeInTheDocument();
    bump(1);
    bump(1);
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() => expect(api.scale).toHaveBeenCalledWith(expect.objectContaining({ gitopsOwner: "Argo CD: shop-app" })));
  });

  it("stays open and shows a policy rejection as a card", async () => {
    vi.mocked(api.scale).mockRejectedValueOnce(new PolicyRejectionError({ engine: "kyverno", webhook: "w", message: "max 10 replicas" }));
    const onClose = vi.fn();
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={onClose} />);
    for (let i = 0; i < 47; i++) bump(1);
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
    expect(api.restart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm restart?" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.restart).toHaveBeenCalledWith({ cluster: "kind-shop", gvr: "apps/v1/statefulsets", ns: "shop", name: "web", gitopsOwner: undefined });
  });

  it("stays open with the error when the restart fails", async () => {
    vi.mocked(api.restart).mockRejectedValueOnce(new Error("forbidden: cannot patch"));
    const onClose = vi.fn();
    render(<WorkloadActionDialog action="restart" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm restart?" }));
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

describe("WorkloadActionDialog: blast-radius preview", () => {
  it("shows What this affects for a restart", () => {
    render(<WorkloadActionDialog action="restart" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /What this affects/ })).toBeInTheDocument();
  });

  it("shows it only once a scale reaches zero", () => {
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(1)} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /What this affects/ })).not.toBeInTheDocument();
    bump(-1);
    expect(screen.getByRole("button", { name: /What this affects/ })).toBeInTheDocument();
  });

  it("shows it for a scale down to a non-zero count, and hides it again going back up", () => {
    render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(5)} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /What this affects/ })).not.toBeInTheDocument();
    bump(-1);
    expect(screen.getByRole("button", { name: /What this affects/ })).toBeInTheDocument();
    bump(1);
    bump(1);
    expect(screen.queryByRole("button", { name: /What this affects/ })).not.toBeInTheDocument();
  });
});

describe("WorkloadActionDialog — scale stepper (backlog #69)", () => {
  const dlg = () => render(<WorkloadActionDialog action="scale" slug="deployments" cluster="kind-shop" obj={deploy(3)} onClose={() => {}} />);
  it("shows an Unsaved hint while the count differs and takes a typed number", async () => {
    vi.mocked(api.scale).mockResolvedValueOnce({ ok: true });
    dlg();
    expect(screen.queryByText("Unsaved")).toBeNull();
    fireEvent.change(field(), { target: { value: "40" } });
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() => expect(api.scale).toHaveBeenCalledWith(expect.objectContaining({ replicas: 40 })));
  });
  it("still previews a scale down to zero", () => {
    dlg();
    fireEvent.change(field(), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /What this affects/ })).toBeInTheDocument();
  });
});
