import { describe, it, expect } from "vitest";
import { detectImageSignatureEngines, summarizeImageSignaturePolicies } from "../imageSignature";
import type { CRDEntry } from "../api";

function crd(group: string, resource: string, version = "v1"): CRDEntry {
  return { name: `${resource}.${group}`, group, version, resource, kind: resource, namespaced: false, gvr: `${group}/${version}/${resource}`, columns: [] };
}

function kyvernoPolicy(name: string, spec: Record<string, unknown>, ns?: string) {
  return { metadata: { name, ...(ns ? { namespace: ns } : {}) }, spec };
}
const verifyRule = (verifyImages: Record<string, unknown>[]) => ({ name: "check-signature", verifyImages });

function cip(name: string, spec: Record<string, unknown> = {}) {
  return { metadata: { name }, spec: { images: [{ glob: "ghcr.io/acme/**" }], ...spec } };
}
function namespace(name: string, labels: Record<string, string> = {}) {
  return { metadata: { name, labels } };
}

describe("detectImageSignatureEngines", () => {
  it("finds Kyverno and Sigstore policy-controller from their CRDs", () => {
    const d = detectImageSignatureEngines([
      crd("kyverno.io", "clusterpolicies"),
      crd("kyverno.io", "policies"),
      crd("policy.sigstore.dev", "clusterimagepolicies", "v1beta1"),
    ]);
    expect(d.kyvernoClusterPolicyGvr).toBe("kyverno.io/v1/clusterpolicies");
    expect(d.kyvernoPolicyGvr).toBe("kyverno.io/v1/policies");
    expect(d.sigstoreClusterImagePolicyGvr).toBe("policy.sigstore.dev/v1beta1/clusterimagepolicies");
  });

  it("returns nothing when neither engine is installed", () => {
    expect(detectImageSignatureEngines([crd("apps", "deployments")])).toEqual({});
  });
});

describe("summarizeImageSignaturePolicies", () => {
  it("reports none when there are no signature policies", () => {
    const r = summarizeImageSignaturePolicies({ kyverno: [kyvernoPolicy("p", { rules: [{ name: "x", validate: {} }] })], sigstore: [], namespaces: [] });
    expect(r.status).toBe("none");
    expect(r.policies).toEqual([]);
  });

  it("reads a Kyverno verifyImages rule in Enforce mode from spec.validationFailureAction", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [kyvernoPolicy("verify", { validationFailureAction: "Enforce", rules: [verifyRule([{ imageReferences: ["ghcr.io/acme/*"] }])] })],
      sigstore: [],
      namespaces: [],
    });
    expect(r.status).toBe("enforced");
    expect(r.policies).toEqual([{ engine: "kyverno", name: "verify", mode: "enforce", images: ["ghcr.io/acme/*"] }]);
  });

  it("defaults a Kyverno policy with no failure action to audit", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [kyvernoPolicy("verify", { rules: [verifyRule([{ imageReferences: ["*"] }])] })],
      sigstore: [],
      namespaces: [],
    });
    expect(r.status).toBe("audit-only");
    expect(r.policies[0]?.mode).toBe("audit");
  });

  it("lets a per-entry failureAction (Kyverno 1.13+) override the policy-level action", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [kyvernoPolicy("verify", { validationFailureAction: "Audit", rules: [verifyRule([{ imageReferences: ["*"], failureAction: "Enforce" }])] })],
      sigstore: [],
      namespaces: [],
    });
    expect(r.policies[0]?.mode).toBe("enforce");
  });

  it("accepts the legacy lowercase action and the legacy `image` field", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [kyvernoPolicy("old", { validationFailureAction: "enforce", rules: [verifyRule([{ image: "docker.io/acme/*" }])] })],
      sigstore: [],
      namespaces: [],
    });
    expect(r.policies[0]).toMatchObject({ mode: "enforce", images: ["docker.io/acme/*"] });
  });

  it("keeps a namespaced Kyverno Policy's namespace", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [kyvernoPolicy("verify", { validationFailureAction: "Enforce", rules: [verifyRule([{ imageReferences: ["*"] }])] }, "shop")],
      sigstore: [],
      namespaces: [],
    });
    expect(r.policies[0]?.ns).toBe("shop");
  });

  it("counts a Sigstore ClusterImagePolicy as enforcing only when some namespace opts in", () => {
    const noOptIn = summarizeImageSignaturePolicies({ kyverno: [], sigstore: [cip("acme")], namespaces: [namespace("shop")] });
    expect(noOptIn.status).toBe("audit-only");
    expect(noOptIn.sigstoreNamespaces).toEqual([]);

    const optIn = summarizeImageSignaturePolicies({
      kyverno: [],
      sigstore: [cip("acme")],
      namespaces: [namespace("shop", { "policy.sigstore.dev/include": "true" }), namespace("dev")],
    });
    expect(optIn.status).toBe("enforced");
    expect(optIn.sigstoreNamespaces).toEqual(["shop"]);
    expect(optIn.policies[0]).toEqual({ engine: "sigstore", name: "acme", mode: "enforce", images: ["ghcr.io/acme/**"] });
  });

  it("treats a Sigstore policy in warn mode as audit", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [],
      sigstore: [cip("acme", { mode: "warn" })],
      namespaces: [namespace("shop", { "policy.sigstore.dev/include": "true" })],
    });
    expect(r.status).toBe("audit-only");
    expect(r.policies[0]?.mode).toBe("audit");
  });
});
