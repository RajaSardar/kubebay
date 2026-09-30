import type { CRDEntry } from "./api";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface ImageSignatureDetection {
  kyvernoClusterPolicyGvr?: string;
  kyvernoPolicyGvr?: string;
  sigstoreClusterImagePolicyGvr?: string;
}

/** Same CRD-discovery pattern as detectKeda/detectTrivyOperator: served GVRs come off /api/crds, never hardcoded. */
export function detectImageSignatureEngines(crds: CRDEntry[]): ImageSignatureDetection {
  const find = (group: string, resource: string) => crds.find((c) => c.group === group && c.resource === resource)?.gvr;
  const out: ImageSignatureDetection = {};
  const kcp = find("kyverno.io", "clusterpolicies");
  const kp = find("kyverno.io", "policies");
  const cip = find("policy.sigstore.dev", "clusterimagepolicies");
  if (kcp) out.kyvernoClusterPolicyGvr = kcp;
  if (kp) out.kyvernoPolicyGvr = kp;
  if (cip) out.sigstoreClusterImagePolicyGvr = cip;
  return out;
}

export type EnforcementMode = "enforce" | "audit";

export interface SignaturePolicy {
  engine: "kyverno" | "sigstore";
  name: string;
  ns?: string;
  mode: EnforcementMode;
  images: string[];
}

export interface ImageSignatureReport {
  status: "none" | "audit-only" | "enforced";
  policies: SignaturePolicy[];
  /** Namespaces opted in to Sigstore policy-controller (`policy.sigstore.dev/include=true`). */
  sigstoreNamespaces: string[];
}

const SIGSTORE_OPT_IN = "policy.sigstore.dev/include";

function kyvernoMode(action: string): EnforcementMode | undefined {
  const a = action.toLowerCase();
  if (a === "enforce") return "enforce";
  if (a === "audit") return "audit";
  return undefined;
}

function kyvernoSignaturePolicy(p: Record<string, unknown>): SignaturePolicy | null {
  const meta = rec(p.metadata);
  const spec = rec(p.spec);
  const entries = arr(spec.rules).flatMap((r) => arr(rec(r).verifyImages)).map(rec);
  if (entries.length === 0) return null;

  // Kyverno 1.13+ sets failureAction per verifyImages entry; older releases only at spec level. Audit is the default.
  const policyMode = kyvernoMode(str(spec.validationFailureAction)) ?? "audit";
  const modes = entries.map((e) => kyvernoMode(str(e.failureAction)) ?? policyMode);
  const images = entries.flatMap((e) => [...arr(e.imageReferences).map(str), str(e.image)]).filter(Boolean);

  const ns = str(meta.namespace);
  return {
    engine: "kyverno",
    name: str(meta.name),
    ...(ns ? { ns } : {}),
    mode: modes.includes("enforce") ? "enforce" : "audit",
    images,
  };
}

function sigstoreSignaturePolicy(p: Record<string, unknown>): SignaturePolicy {
  const spec = rec(p.spec);
  return {
    engine: "sigstore",
    name: str(rec(p.metadata).name),
    // policy-controller's default mode is enforce; "warn" only admits with a warning.
    mode: str(spec.mode) === "warn" ? "audit" : "enforce",
    images: arr(spec.images).map((i) => str(rec(i).glob)).filter(Boolean),
  };
}

/**
 * Backlog #32: is image signature verification actually enforced? Kyverno
 * verifyImages rules and Sigstore ClusterImagePolicies are the two common
 * engines. A Sigstore policy only takes effect in namespaces labelled
 * policy.sigstore.dev/include=true, so policies with no opted-in namespace
 * enforce nothing and count as audit-only.
 */
export function summarizeImageSignaturePolicies(input: {
  kyverno: Record<string, unknown>[];
  sigstore: Record<string, unknown>[];
  namespaces: Record<string, unknown>[];
}): ImageSignatureReport {
  const kyverno = input.kyverno.map(kyvernoSignaturePolicy).filter((p): p is SignaturePolicy => p !== null);
  const sigstore = input.sigstore.map(sigstoreSignaturePolicy);
  const sigstoreNamespaces = input.namespaces
    .filter((n) => rec(rec(n.metadata).labels)[SIGSTORE_OPT_IN] === "true")
    .map((n) => str(rec(n.metadata).name))
    .sort();

  const policies = [...kyverno, ...sigstore];
  const enforced =
    kyverno.some((p) => p.mode === "enforce") || (sigstoreNamespaces.length > 0 && sigstore.some((p) => p.mode === "enforce"));

  return {
    status: policies.length === 0 ? "none" : enforced ? "enforced" : "audit-only",
    policies,
    sigstoreNamespaces,
  };
}
