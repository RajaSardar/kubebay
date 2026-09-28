import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionsBar } from "../ActionsBar";
import { api } from "../../lib/api";
import { PolicyRejectionError } from "../../lib/policyRejection";

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

describe("ActionsBar — structured policy rejection (backlog #17)", () => {
  it("renders the structured PolicyRejectionCard instead of a raw error string on a 422 rejection", async () => {
    vi.mocked(api.scale).mockRejectedValueOnce(
      new PolicyRejectionError({ engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "label 'team' is required" }),
    );
    render(<ActionsBar {...props} />);

    fireEvent.change(screen.getByPlaceholderText("n"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /apply scale/i }));

    expect(await screen.findByText(/kyverno policy rejected this change/i)).toBeTruthy();
    expect(screen.getByText("validate.kyverno.svc-fail")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api.scale)).toHaveBeenCalled());
  });

  it("still shows a plain error string for a non-policy failure", async () => {
    vi.mocked(api.scale).mockRejectedValueOnce(new Error("connection refused"));
    render(<ActionsBar {...props} />);

    fireEvent.change(screen.getByPlaceholderText("n"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /apply scale/i }));

    expect(await screen.findByText(/connection refused/)).toBeTruthy();
  });
});
