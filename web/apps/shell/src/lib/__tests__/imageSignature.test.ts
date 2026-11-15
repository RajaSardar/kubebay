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
    // dev isn't opted in, so its pods run unverified: enforced in part.
    expect(optIn.status).toBe("partial");
    expect(optIn.uncovered).toEqual(["dev"]);
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

describe("per-namespace coverage", () => {
  const nss = [namespace("shop"), namespace("billing", { team: "pay" }), namespace("dev-1"), namespace("kube-system")];
  const enforce = (rule: Record<string, unknown>) =>
    kyvernoPolicy("verify", { validationFailureAction: "Enforce", rules: [{ ...verifyRule([{ imageReferences: ["*"] }]), ...rule }] });
  const modeOf = (r: ReturnType<typeof summarizeImageSignaturePolicies>, ns: string) => r.namespaces.find((n) => n.name === ns)?.mode;

  it("a cluster policy with no namespace scope covers every namespace", () => {
    const r = summarizeImageSignaturePolicies({ kyverno: [enforce({ match: { any: [{ resources: { kinds: ["Pod"] } }] } })], sigstore: [], namespaces: nss });
    expect(r.namespaces.map((n) => n.mode)).toEqual(["enforce", "enforce", "enforce", "enforce"]);
    expect(r.status).toBe("enforced");
  });

  it("honours match namespaces (with wildcards), namespaceSelector and exclude", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [
        enforce({
          match: { any: [{ resources: { kinds: ["Pod"], namespaces: ["shop", "dev-*"] } }, { resources: { kinds: ["Pod"], namespaceSelector: { matchLabels: { team: "pay" } } } }] },
          exclude: { any: [{ resources: { namespaces: ["dev-1"] } }] },
        }),
      ],
      sigstore: [],
      namespaces: nss,
    });
    expect(modeOf(r, "shop")).toBe("enforce");
    expect(modeOf(r, "billing")).toBe("enforce");
    expect(modeOf(r, "dev-1")).toBe("none");
    expect(r.status).toBe("partial");
    expect(r.uncovered).toEqual(["dev-1"]);
  });

  it("does not count a rule for other kinds, and an exclude by user does not exclude a namespace", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [
        enforce({ match: { resources: { kinds: ["Service"] } } }),
        kyvernoPolicy("pods", { rules: [{ ...verifyRule([{ imageReferences: ["*"], failureAction: "Audit" }]), match: { resources: { kinds: ["Deployment"] } }, exclude: { any: [{ subjects: [{ kind: "User", name: "ci" }] }] } }] }),
      ],
      sigstore: [],
      namespaces: [namespace("shop")],
    });
    expect(modeOf(r, "shop")).toBe("audit");
    expect(r.status).toBe("audit-only");
  });

  it("a namespaced Kyverno Policy covers only its own namespace", () => {
    const local = kyvernoPolicy("verify", { validationFailureAction: "Enforce", rules: [verifyRule([{ imageReferences: ["*"] }])] }, "shop");
    const r = summarizeImageSignaturePolicies({ kyverno: [local], sigstore: [], namespaces: nss });
    expect(modeOf(r, "shop")).toBe("enforce");
    expect(modeOf(r, "billing")).toBe("none");
  });

  it("system namespaces are listed but never make coverage partial", () => {
    const r = summarizeImageSignaturePolicies({
      kyverno: [enforce({ match: { any: [{ resources: { kinds: ["Pod"] } }] }, exclude: { any: [{ resources: { namespaces: ["kube-system"] } }] } })],
      sigstore: [],
      namespaces: nss,
    });
    expect(r.namespaces.find((n) => n.name === "kube-system")).toMatchObject({ mode: "none", system: true });
    expect(r.status).toBe("enforced");
  });

  it("Sigstore covers only opted-in namespaces", () => {
    const r = summarizeImageSignaturePolicies({ kyverno: [], sigstore: [cip("acme")], namespaces: [namespace("shop", { "policy.sigstore.dev/include": "true" }), namespace("billing")] });
    expect(modeOf(r, "shop")).toBe("enforce");
    expect(modeOf(r, "billing")).toBe("none");
    expect(r.status).toBe("partial");
  });
});

describe("Connaisseur and Ratify", () => {
  it("detects Ratify from its CRDs and the Gatekeeper constraint kind", () => {
    const d = detectImageSignatureEngines([crd("config.ratify.deislabs.io", "verifiers", "v1beta1"), crd("constraints.gatekeeper.sh", "ratifyverification", "v1beta1")]);
    expect(d.ratifyInstalled).toBe(true);
    expect(d.ratifyConstraintGvr).toBe("constraints.gatekeeper.sh/v1beta1/ratifyverification");
  });

  it("reads Ratify enforcement and scope from Gatekeeper constraints", () => {
    const constraint = (name: string, enforcementAction: string, match: Record<string, unknown>) => ({ metadata: { name }, spec: { enforcementAction, match } });
    const r = summarizeImageSignaturePolicies({
      kyverno: [],
      sigstore: [],
      ratifyConstraints: [constraint("verify-prod", "deny", { namespaces: ["shop"] }), constraint("verify-dry", "dryrun", { excludedNamespaces: ["shop"] })],
      namespaces: [namespace("shop"), namespace("billing")],
    });
    expect(r.policies.map((p) => `${p.engine}:${p.name}:${p.mode}`)).toEqual(["ratify:verify-prod:enforce", "ratify:verify-dry:audit"]);
    expect(r.namespaces.map((n) => `${n.name}:${n.mode}`)).toEqual(["shop:enforce", "billing:audit"]);
  });

  it("detects Connaisseur from its validating webhook and scopes it by namespaceSelector", () => {
    const webhook = {
      metadata: { name: "connaisseur-webhook" },
      webhooks: [{ name: "connaisseur-svc.connaisseur.svc", namespaceSelector: { matchExpressions: [{ key: "securesystemsengineering.connaisseur/webhook", operator: "NotIn", values: ["ignore"] }] } }],
    };
    const other = { metadata: { name: "kyverno-resource-validating-webhook-cfg" }, webhooks: [{ name: "validate.kyverno.svc" }] };
    const r = summarizeImageSignaturePolicies({
      kyverno: [],
      sigstore: [],
      validatingWebhooks: [webhook, other],
      namespaces: [namespace("shop"), namespace("legacy", { "securesystemsengineering.connaisseur/webhook": "ignore" })],
    });
    expect(r.policies).toEqual([{ engine: "connaisseur", name: "connaisseur-webhook", mode: "enforce", images: [] }]);
    expect(r.namespaces.map((n) => `${n.name}:${n.mode}`)).toEqual(["shop:enforce", "legacy:none"]);
  });
});
