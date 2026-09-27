import { describe, it, expect } from "vitest";
import { ownerOf, ownerLabel, ownerWarning } from "../gitops";

function withAnnotations(annotations: Record<string, string>): Record<string, unknown> {
  return { metadata: { annotations } };
}

describe("ownerOf", () => {
  it("returns null for an object with no GitOps annotations", () => {
    expect(ownerOf(withAnnotations({}))).toBeNull();
    expect(ownerOf({ metadata: {} })).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(ownerOf(null)).toBeNull();
    expect(ownerOf(undefined)).toBeNull();
  });

  it("detects Argo CD via the instance annotation", () => {
    const owner = ownerOf(withAnnotations({ "argocd.argoproj.io/instance": "my-app" }));
    expect(owner).toEqual({ controller: "argocd", name: "my-app" });
  });

  it("detects Argo CD via tracking-id, extracting the app name before the first colon", () => {
    const owner = ownerOf(
      withAnnotations({ "argocd.argoproj.io/tracking-id": "my-app:apps/Deployment:default/my-deploy" }),
    );
    expect(owner).toEqual({ controller: "argocd", name: "my-app" });
  });

  it("prefers the instance annotation over tracking-id when both are present", () => {
    const owner = ownerOf(
      withAnnotations({
        "argocd.argoproj.io/instance": "instance-app",
        "argocd.argoproj.io/tracking-id": "tracking-app:apps/Deployment:default/my-deploy",
      }),
    );
    expect(owner).toEqual({ controller: "argocd", name: "instance-app" });
  });

  it("detects Flux via the Kustomization name annotation", () => {
    const owner = ownerOf(withAnnotations({ "kustomize.toolkit.fluxcd.io/name": "my-kustomization" }));
    expect(owner).toEqual({ controller: "flux", name: "my-kustomization" });
  });

  it("detects Flux via the HelmRelease name annotation", () => {
    const owner = ownerOf(withAnnotations({ "helm.toolkit.fluxcd.io/name": "my-release" }));
    expect(owner).toEqual({ controller: "flux", name: "my-release" });
  });

  it("prefers Argo over Flux when (implausibly) both are present", () => {
    const owner = ownerOf(
      withAnnotations({
        "argocd.argoproj.io/instance": "argo-app",
        "kustomize.toolkit.fluxcd.io/name": "flux-kustomization",
      }),
    );
    expect(owner?.controller).toBe("argocd");
  });
});

describe("ownerLabel", () => {
  it("formats an Argo CD owner", () => {
    expect(ownerLabel({ controller: "argocd", name: "my-app" })).toBe("Argo CD: my-app");
  });

  it("formats a Flux owner", () => {
    expect(ownerLabel({ controller: "flux", name: "my-kustomization" })).toBe("Flux: my-kustomization");
  });
});

describe("ownerWarning", () => {
  it("names the controller and app, and points at Git rather than implying a hard block", () => {
    const msg = ownerWarning({ controller: "argocd", name: "my-app" });
    expect(msg).toContain("Argo CD");
    expect(msg).toContain("my-app");
    expect(msg.toLowerCase()).toContain("git");
  });

  it("gives Flux its own wording since it corrects drift rather than just reporting it", () => {
    const msg = ownerWarning({ controller: "flux", name: "my-kustomization" });
    expect(msg).toContain("Flux");
    expect(msg).toContain("my-kustomization");
  });
});
