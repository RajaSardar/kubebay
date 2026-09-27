import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetadataSummary } from "../MetadataSummary";

describe("MetadataSummary — GitOps ownership badge", () => {
  it("shows an Argo CD badge when the object carries the instance annotation", () => {
    render(
      <MetadataSummary
        obj={{ metadata: { annotations: { "argocd.argoproj.io/instance": "my-app" } } }}
      />,
    );
    expect(screen.getByText("Argo CD: my-app")).toBeTruthy();
  });

  it("shows a Flux badge when the object carries a Kustomization name annotation", () => {
    render(
      <MetadataSummary
        obj={{ metadata: { annotations: { "kustomize.toolkit.fluxcd.io/name": "my-kustomization" } } }}
      />,
    );
    expect(screen.getByText("Flux: my-kustomization")).toBeTruthy();
  });

  it("shows no GitOps badge for an object with no GitOps annotations", () => {
    render(<MetadataSummary obj={{ metadata: { annotations: {} } }} />);
    expect(screen.queryByText(/Argo CD:|Flux:/)).toBeNull();
  });
});
