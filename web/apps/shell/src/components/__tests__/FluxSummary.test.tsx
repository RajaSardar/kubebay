import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FluxSummary } from "../FluxSummary";
import type { FluxObjectStatus } from "../../lib/flux";

function status(overrides: Partial<FluxObjectStatus> = {}): FluxObjectStatus {
  return {
    kind: "Kustomization",
    name: "apps",
    ns: "flux-system",
    ready: true,
    suspended: false,
    readyMessage: "Applied revision: main@sha1:abc123",
    managedResourceCount: 12,
    driftEventCount: 0,
    ...overrides,
  };
}

describe("FluxSummary", () => {
  it("shows an empty state when there are no Flux objects", () => {
    render(<FluxSummary items={[]} />);
    expect(screen.getByText(/no kustomizations or helmreleases/i)).toBeTruthy();
  });

  it("shows a ready object's name, message, and managed resource count", () => {
    render(<FluxSummary items={[status()]} />);
    expect(screen.getByText("apps")).toBeTruthy();
    expect(screen.getByText(/Applied revision/)).toBeTruthy();
    expect(screen.getByText(/manages 12 resources/i)).toBeTruthy();
  });

  it("flags a not-ready object distinctly", () => {
    render(<FluxSummary items={[status({ ready: false, readyMessage: "build failed" })]} />);
    expect(screen.getByText("build failed")).toBeTruthy();
    expect(screen.getByText(/not ready/i)).toBeTruthy();
  });

  it("shows an unknown state when there is no Ready condition at all", () => {
    render(<FluxSummary items={[status({ ready: null, readyMessage: "" })]} />);
    expect(screen.getByText(/unknown/i)).toBeTruthy();
  });

  it("surfaces a drift-detected count when present", () => {
    render(<FluxSummary items={[status({ driftEventCount: 3 })]} />);
    expect(screen.getByText(/drift detected.*3/i)).toBeTruthy();
  });
});

describe("FluxSummary actions", () => {
  it("shows a Suspended pill and Resume for a suspended object when it can act", () => {
    const obj = { metadata: { name: "apps", namespace: "flux-system" }, spec: { suspend: true } };
    render(<FluxSummary cluster="kind-test" items={[status({ suspended: true, gvr: "kustomize.toolkit.fluxcd.io/v1/kustomizations", obj })]} />);
    expect(screen.getByText("Suspended")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });
});
