import { describe, it, expect } from "vitest";
import { detectFlux, summarizeFluxObject } from "../flux";
import type { CRDEntry } from "../api";

function crd(overrides: Partial<CRDEntry> = {}): CRDEntry {
  return {
    name: "kustomizations.kustomize.toolkit.fluxcd.io",
    group: "kustomize.toolkit.fluxcd.io",
    version: "v1",
    resource: "kustomizations",
    kind: "Kustomization",
    namespaced: true,
    gvr: "kustomize.toolkit.fluxcd.io/v1/kustomizations",
    columns: [],
    ...overrides,
  };
}

function fluxObj(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "apps", namespace: "flux-system" },
    status: {
      conditions: [{ type: "Ready", status: "True", message: "Applied revision: main@sha1:abc123" }],
      inventory: { entries: [{ id: "default_app_apps_Deployment", v: "v1" }, { id: "default_app_v1_Service", v: "v1" }] },
    },
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    reason: "DriftDetected",
    involvedObject: { kind: "Kustomization", name: "apps", namespace: "flux-system" },
    ...overrides,
  };
}

describe("detectFlux", () => {
  it("detects Kustomization and HelmRelease CRDs regardless of served version", () => {
    const crds = [crd(), crd({ name: "helmreleases.helm.toolkit.fluxcd.io", group: "helm.toolkit.fluxcd.io", resource: "helmreleases", kind: "HelmRelease", gvr: "helm.toolkit.fluxcd.io/v2/helmreleases" })];
    const d = detectFlux(crds);
    expect(d.installed).toBe(true);
    expect(d.kustomizationGvr).toBe("kustomize.toolkit.fluxcd.io/v1/kustomizations");
    expect(d.helmReleaseGvr).toBe("helm.toolkit.fluxcd.io/v2/helmreleases");
  });

  it("reports not installed when neither CRD is present", () => {
    expect(detectFlux([]).installed).toBe(false);
  });

  it("reports installed when only one of the two CRDs is present", () => {
    expect(detectFlux([crd()]).installed).toBe(true);
  });
});

describe("summarizeFluxObject", () => {
  it("reads the Ready condition's status and message", () => {
    const s = summarizeFluxObject(fluxObj(), "Kustomization", []);
    expect(s.ready).toBe(true);
    expect(s.readyMessage).toContain("Applied revision");
  });

  it("reports ready: false for a False Ready condition", () => {
    const obj = fluxObj({ status: { conditions: [{ type: "Ready", status: "False", message: "build failed" }] } });
    const s = summarizeFluxObject(obj, "Kustomization", []);
    expect(s.ready).toBe(false);
    expect(s.readyMessage).toBe("build failed");
  });

  it("reports ready: null when there is no Ready condition at all", () => {
    const s = summarizeFluxObject({ metadata: { name: "x", namespace: "y" }, status: {} }, "Kustomization", []);
    expect(s.ready).toBeNull();
  });

  it("counts managed resources from status.inventory.entries", () => {
    const s = summarizeFluxObject(fluxObj(), "Kustomization", []);
    expect(s.managedResourceCount).toBe(2);
  });

  it("counts DriftDetected events whose involvedObject matches this exact object", () => {
    const s = summarizeFluxObject(fluxObj(), "Kustomization", [event()]);
    expect(s.driftEventCount).toBe(1);
  });

  it("does not count a DriftDetected event for a different object", () => {
    const other = event({ involvedObject: { kind: "Kustomization", name: "other", namespace: "flux-system" } });
    const s = summarizeFluxObject(fluxObj(), "Kustomization", [other]);
    expect(s.driftEventCount).toBe(0);
  });

  it("does not count a non-drift event even for the same object", () => {
    const s = summarizeFluxObject(fluxObj(), "Kustomization", [event({ reason: "ReconciliationSucceeded" })]);
    expect(s.driftEventCount).toBe(0);
  });
});
