import { describe, it, expect } from "vitest";
import { DEFS, EXTRA_DEFS, lookupDef } from "../resources";

describe("ResourceDef.kind", () => {
  it("is the singular Kubernetes Kind, not the plural display label", () => {
    expect(DEFS.deployments?.kind).toBe("Deployment");
    expect(DEFS.deployments?.label).toBe("Deployments");
    expect(DEFS.poddisruptionbudgets?.kind).toBe("PodDisruptionBudget");
    expect(DEFS.csidrivers?.kind).toBe("CSIDriver");
    expect(EXTRA_DEFS.namespaces?.kind).toBe("Namespace");
  });

  it("is set on every built-in def", () => {
    for (const d of [...Object.values(DEFS), ...Object.values(EXTRA_DEFS)]) {
      expect(d.kind, d.slug).toMatch(/^[A-Z]/);
    }
  });
});

describe("lookupDef", () => {
  const sp = new URLSearchParams();

  it("returns built-in defs by slug", () => {
    expect(lookupDef("deployments", sp)?.gvr).toBe("apps/v1/deployments");
    expect(lookupDef("namespaces", sp)?.gvr).toBe("v1/namespaces");
  });

  it("synthesizes a def for an ext-- CRD route", () => {
    const d = lookupDef("ext--karpenter.sh--v1--nodepools", sp);
    expect(d?.gvr).toBe("karpenter.sh/v1/nodepools");
    expect(d?.group).toBe("karpenter.sh");
    expect(d?.mode).toBe("full");
  });

  it("guesses a singular Kind for CRDs pending the declared one", () => {
    expect(lookupDef("ext--karpenter.sh--v1--nodeclaims", sp)?.kind).toBe("Nodeclaim");
    expect(lookupDef("ext--cert-manager.io--v1--certificates", sp)?.kind).toBe("Certificate");
    expect(lookupDef("ext--example.com--v1--policies", sp)?.kind).toBe("Policy");
  });

  it("returns undefined for unknown or malformed slugs", () => {
    expect(lookupDef("nope", sp)).toBeUndefined();
    expect(lookupDef("ext--v1", sp)).toBeUndefined();
  });

  it("treats scoped=0 as cluster-scoped", () => {
    expect(lookupDef("ext--karpenter.sh--v1--nodepools", new URLSearchParams("scoped=0"))?.scoped).toBe(true);
    expect(lookupDef("ext--karpenter.sh--v1--nodepools", sp)?.scoped).toBe(false);
  });
});
