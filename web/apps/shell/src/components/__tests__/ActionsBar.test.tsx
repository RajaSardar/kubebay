import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionsBar } from "../ActionsBar";
import { api } from "../../lib/api";
import { PolicyRejectionError } from "../../lib/policyRejection";

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: () => ({ rows: [], synced: true, connected: true }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, scale: vi.fn() } };
});

const props = { slug: "deployments" as const, cluster: "kind-test", ns: "default", name: "example" };

describe("ActionsBar — GitOps ownership warning", () => {
  it("shows no warning when the resource has no GitOps owner", () => {
    render(<ActionsBar {...props} />);
    expect(screen.queryByText(/manages this resource/)).toBeNull();
  });

  it("warns before scale/restart when the resource is Argo CD-managed", () => {
    render(<ActionsBar {...props} gitopsOwner={{ controller: "argocd", name: "my-app" }} />);
    const warning = screen.getByText(/manages this resource/);
    expect(warning.textContent).toContain("Argo CD");
    expect(warning.textContent).toContain("my-app");
  });

  it("warns before cordon/drain on a Flux-managed node", () => {
    render(<ActionsBar slug="nodes" cluster="kind-test" ns="" name="node-1" gitopsOwner={{ controller: "flux", name: "my-kustomization" }} />);
    const warning = screen.getByText(/manages this resource/);
    expect(warning.textContent).toContain("Flux");
  });
});

describe("ActionsBar — replicas stepper (backlog #5)", () => {
  it("shows − and + buttons with the current replica count", () => {
    render(<ActionsBar {...props} currentReplicas={3} />);
    expect(screen.getByRole("button", { name: "Decrease replicas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Increase replicas" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("+ increments, − decrements the displayed count", () => {
    render(<ActionsBar {...props} currentReplicas={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Decrease replicas" }));
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("− is disabled when count is 0", () => {
    render(<ActionsBar {...props} currentReplicas={0} />);
    expect(screen.getByRole("button", { name: "Decrease replicas" })).toBeDisabled();
  });

  it("Apply scale is disabled when count equals current replicas", () => {
    render(<ActionsBar {...props} currentReplicas={3} />);
    expect(screen.getByRole("button", { name: /apply scale/i })).toBeDisabled();
  });

  it("Apply scale is enabled after changing count", () => {
    render(<ActionsBar {...props} currentReplicas={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    expect(screen.getByRole("button", { name: /apply scale/i })).not.toBeDisabled();
  });

  it("calls api.scale with the updated count", async () => {
    vi.mocked(api.scale).mockResolvedValueOnce({ ok: true } as never);
    render(<ActionsBar {...props} currentReplicas={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: /apply scale/i }));
    await waitFor(() => expect(api.scale).toHaveBeenCalledWith(expect.objectContaining({ replicas: 3 })));
  });
});

describe("ActionsBar — blast-radius preview on a scale down", () => {
  it("shows What this affects only while the count is below the current one", () => {
    render(<ActionsBar {...props} currentReplicas={3} />);
    expect(screen.queryByRole("button", { name: /What this affects/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Decrease replicas" }));
    expect(screen.getByRole("button", { name: /What this affects/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    expect(screen.queryByRole("button", { name: /What this affects/ })).toBeNull();
  });

  it("shows it for a scale to zero too", () => {
    render(<ActionsBar {...props} currentReplicas={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Decrease replicas" }));
    expect(screen.getByRole("button", { name: /What this affects/ })).toBeInTheDocument();
  });
});

describe("ActionsBar — replicas follows live value (regression)", () => {
  it("shows the real count when currentReplicas arrives after mount", () => {
    const { rerender } = render(<ActionsBar {...props} />);
    rerender(<ActionsBar {...props} currentReplicas={5} />);
    expect(screen.getByText("5")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Decrease replicas"));
    expect(screen.getByText("4")).toBeTruthy();
  });
});

describe("ActionsBar — structured policy rejection (backlog #17)", () => {
  it("renders the structured PolicyRejectionCard instead of a raw error string on a 422 rejection", async () => {
    vi.mocked(api.scale).mockRejectedValueOnce(
      new PolicyRejectionError({ engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "label 'team' is required" }),
    );
    render(<ActionsBar {...props} currentReplicas={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: /apply scale/i }));

    expect(await screen.findByText(/kyverno policy rejected this change/i)).toBeTruthy();
    expect(screen.getByText("validate.kyverno.svc-fail")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api.scale)).toHaveBeenCalled());
  });

  it("still shows a plain error string for a non-policy failure", async () => {
    vi.mocked(api.scale).mockRejectedValueOnce(new Error("connection refused"));
    render(<ActionsBar {...props} currentReplicas={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: /apply scale/i }));

    expect(await screen.findByText(/connection refused/)).toBeTruthy();
  });
});

describe("ActionsBar — Argo Rollouts (backlog #33)", () => {
  it("scales a Rollout like a Deployment", async () => {
    vi.mocked(api.scale).mockResolvedValue(undefined as never);
    render(<ActionsBar slug="rollouts" cluster="kind-test" ns="default" name="web" currentReplicas={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase replicas" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply scale" }));
    await waitFor(() =>
      expect(api.scale).toHaveBeenCalledWith(
        expect.objectContaining({ gvr: "argoproj.io/v1alpha1/rollouts", ns: "default", name: "web", replicas: 3 }),
      ),
    );
  });

  it("restarts a Rollout by setting spec.restartAt, not the pod-template annotation", async () => {
    const applyYaml = vi.spyOn(api, "applyYaml").mockResolvedValue(undefined as never);
    render(<ActionsBar slug="rollouts" cluster="kind-test" ns="default" name="web" currentReplicas={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(applyYaml).toHaveBeenCalledTimes(1));
    const req = applyYaml.mock.calls[0]![0] as { gvr: string; mode: string; action: string; yaml: string };
    expect(req).toMatchObject({ gvr: "argoproj.io/v1alpha1/rollouts", mode: "merge", action: "rollout-restart" });
    expect(JSON.parse(req.yaml).spec.restartAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await screen.findByText(/restart triggered/i)).toBeTruthy();
    applyYaml.mockRestore();
  });
});
