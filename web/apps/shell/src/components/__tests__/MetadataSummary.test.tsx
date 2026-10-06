import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MetadataSummary } from "../MetadataSummary";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../lib/useOwnerChain", () => ({
  useOwnerChain: (_cluster: string, _ns: string, refs: { kind: string; name: string }[]) =>
    refs.map((r) => ({ kind: r.kind, name: r.name, slug: r.kind.toLowerCase() + "s", ns: "prod" })),
}));

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
    render(
      <MemoryRouter>
        <MetadataSummary obj={{ metadata: { annotations: {} } }} cluster="kind" ns="prod" />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Argo CD:|Flux:/)).toBeNull();
  });
});

describe("MetadataSummary — owner chain links (backlog #14)", () => {
  it("shows owner references as clickable links when cluster+ns are provided", () => {
    render(
      <MemoryRouter>
        <MetadataSummary
          cluster="kind"
          ns="prod"
          obj={{
            metadata: {
              namespace: "prod",
              ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name: "web", controller: true }],
            },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Deployment/web")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Deployment/web"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/deployments/prod/web");
  });

  it("falls back to plain text when cluster/ns not provided", () => {
    render(
      <MemoryRouter>
        <MetadataSummary
          obj={{
            metadata: {
              ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name: "web", controller: true }],
            },
          }}
        />
      </MemoryRouter>,
    );
    // Still shows the owner, just not as a navigable link
    expect(screen.getByText(/Deployment/)).toBeInTheDocument();
    expect(screen.getByText(/web/)).toBeInTheDocument();
  });
});
