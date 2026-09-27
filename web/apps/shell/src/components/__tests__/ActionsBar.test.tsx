import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionsBar } from "../ActionsBar";

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
