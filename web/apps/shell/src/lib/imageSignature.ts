import type { CRDEntry } from "./api";
import { matchesSelector, type LabelSelector } from "./labelSelector";

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
  /** Ratify's own CRDs are installed (it verifies through Gatekeeper). */
  ratifyInstalled?: boolean;
  /** Gatekeeper's RatifyVerification constraint kind, which is what enforces. */
  ratifyConstraintGvr?: string;
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
  if (crds.some((c) => c.group === "config.ratify.deislabs.io")) out.ratifyInstalled = true;
  const ratify = find("constraints.gatekeeper.sh", "ratifyverification");
  if (ratify) out.ratifyConstraintGvr = ratify;
  return out;
}

export type EnforcementMode = "enforce" | "audit";

export interface SignaturePolicy {
  engine: "kyverno" | "sigstore" | "ratify" | "connaisseur";
  name: string;
  ns?: string;
  mode: EnforcementMode;
  images: string[];
}

export interface NamespaceCoverage {
  name: string;
  mode: EnforcementMode | "none";
  /** kube-*, and the verification engines' own namespaces: often excluded on purpose. */
  system: boolean;
}

export interface ImageSignatureReport {
  /** partial: enforced in some application namespaces but not all. */
  status: "none" | "audit-only" | "partial" | "enforced";
  policies: SignaturePolicy[];
  /** Namespaces opted in to Sigstore policy-controller (`policy.sigstore.dev/include=true`). */
  sigstoreNamespaces: string[];
  /** Per-namespace verdict, in the order the namespaces were given. */
  namespaces: NamespaceCoverage[];
  /** Application namespaces where nothing enforces signatures. */
  uncovered: string[];
}

type Obj = Record<string, unknown>;
interface Ns {
  name: string;
  labels: Record<string, string>;
}
/** Which mode, if any, a policy applies in a namespace. */
type Scope = (ns: Ns) => EnforcementMode | undefined;

const SYSTEM_NS = /^(kube-.*|kyverno|cosign-system|gatekeeper-system|connaisseur)$/;

function glob(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return re.test(value);
}

const POD_KINDS = new Set(["Pod", "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "*"]);

const SIGSTORE_OPT_IN = "policy.sigstore.dev/include";

function kyvernoMode(action: string): EnforcementMode | undefined {
  const a = action.toLowerCase();
  if (a === "enforce") return "enforce";
  if (a === "audit") return "audit";
  return undefined;
}

/** A Kyverno ResourceFilter's namespace test; a filter for kinds that aren't pods never matches. */
function kyvernoFilterMatches(filter: Obj, ns: Ns): boolean {
  const res = rec(filter.resources);
  const kinds = arr(res.kinds).map(str);
  if (kinds.length && !kinds.some((k) => POD_KINDS.has(k.split("/").pop() ?? k))) return false;
  const names = arr(res.namespaces).map(str);
  if (names.length && !names.some((n) => glob(n, ns.name))) return false;
  if (res.namespaceSelector && !matchesSelector(ns.labels, rec(res.namespaceSelector) as LabelSelector)) return false;
  return true;
}

function kyvernoBlockMatches(block: Obj, ns: Ns, empty: boolean, onlyResources: boolean): boolean {
  const usable = (fs: Obj[]) => (onlyResources ? fs.filter((f) => f.resources) : fs);
  const any = usable(arr(block.any).map(rec));
  const all = usable(arr(block.all).map(rec));
  if (any.length) return any.some((f) => kyvernoFilterMatches(f, ns));
  if (all.length) return all.every((f) => kyvernoFilterMatches(f, ns));
  if (block.resources) return kyvernoFilterMatches(block, ns);
  return empty;
}

function kyvernoSignaturePolicy(p: Obj): { policy: SignaturePolicy; scope: Scope } | null {
  const meta = rec(p.metadata);
  const spec = rec(p.spec);
  const rules = arr(spec.rules).map(rec).filter((r) => arr(r.verifyImages).length > 0);
  if (rules.length === 0) return null;

  // Kyverno 1.13+ sets failureAction per verifyImages entry; older releases only at spec level. Audit is the default.
  const policyMode = kyvernoMode(str(spec.validationFailureAction)) ?? "audit";
  const ruleMode = (r: Obj): EnforcementMode =>
    arr(r.verifyImages).some((e) => (kyvernoMode(str(rec(e).failureAction)) ?? policyMode) === "enforce") ? "enforce" : "audit";
  const entries = rules.flatMap((r) => arr(r.verifyImages)).map(rec);
  const images = entries.flatMap((e) => [...arr(e.imageReferences).map(str), str(e.image)]).filter(Boolean);
  const ownNs = str(meta.namespace);

  const scope: Scope = (ns) => {
    if (ownNs && ns.name !== ownNs) return undefined;
    let best: EnforcementMode | undefined;
    for (const r of rules) {
      // An exclude by user or role exempts requests, not a namespace's pods: only resource filters count.
      if (!kyvernoBlockMatches(rec(r.match), ns, true, false) || kyvernoBlockMatches(rec(r.exclude), ns, false, true)) continue;
      const m = ruleMode(r);
      if (m === "enforce") return m;
      best = m;
    }
    return best;
  };
  return {
    policy: {
      engine: "kyverno",
      name: str(meta.name),
      ...(ownNs ? { ns: ownNs } : {}),
      mode: rules.some((r) => ruleMode(r) === "enforce") ? "enforce" : "audit",
      images,
    },
    scope,
  };
}

/** Gatekeeper RatifyVerification constraint: deny enforces, dryrun and warn only report. */
function ratifyPolicy(c: Obj): { policy: SignaturePolicy; scope: Scope } {
  const spec = rec(c.spec);
  const match = rec(spec.match);
  const mode: EnforcementMode = (str(spec.enforcementAction) || "deny") === "deny" ? "enforce" : "audit";
  const kinds = arr(match.kinds).flatMap((k) => arr(rec(k).kinds).map(str));
  const included = arr(match.namespaces).map(str);
  const excluded = arr(match.excludedNamespaces).map(str);
  const scope: Scope = (ns) => {
    if (kinds.length && !kinds.some((k) => POD_KINDS.has(k))) return undefined;
    if (included.length && !included.some((n) => glob(n, ns.name))) return undefined;
    if (excluded.some((n) => glob(n, ns.name))) return undefined;
    if (match.namespaceSelector && !matchesSelector(ns.labels, rec(match.namespaceSelector) as LabelSelector)) return undefined;
    return mode;
  };
  return { policy: { engine: "ratify", name: str(rec(c.metadata).name), mode, images: [] }, scope };
}

/**
 * Connaisseur runs as a validating webhook and keeps its rules in a ConfigMap
 * the cluster API doesn't describe, so only presence and scope are visible.
 * It denies unsigned images by default; detection mode would only warn.
 */
function connaisseurPolicy(cfg: Obj): { policy: SignaturePolicy; scope: Scope } | null {
  const name = str(rec(cfg.metadata).name);
  const hooks = arr(cfg.webhooks).map(rec);
  if (!name.includes("connaisseur") && !hooks.some((h) => str(h.name).includes("connaisseur"))) return null;
  const scope: Scope = (ns) =>
    hooks.some((h) => !h.namespaceSelector || matchesSelector(ns.labels, rec(h.namespaceSelector) as LabelSelector)) ? "enforce" : undefined;
  return { policy: { engine: "connaisseur", name, mode: "enforce", images: [] }, scope };
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
 * Backlog #32: is image signature verification actually enforced, and where?
 * Kyverno verifyImages rules, Sigstore ClusterImagePolicies, Ratify (through
 * Gatekeeper RatifyVerification constraints) and Connaisseur's webhook are
 * read, and each namespace gets the strongest mode that covers it. A Sigstore
 * policy only takes effect in namespaces labelled policy.sigstore.dev/include=true.
 */
export function summarizeImageSignaturePolicies(input: {
  kyverno: Obj[];
  sigstore: Obj[];
  namespaces: Obj[];
  ratifyConstraints?: Obj[];
  validatingWebhooks?: Obj[];
}): ImageSignatureReport {
  const nss: Ns[] = input.namespaces.map((n) => {
    const name = str(rec(n.metadata).name);
    return { name, labels: { "kubernetes.io/metadata.name": name, ...(rec(rec(n.metadata).labels) as Record<string, string>) } };
  });
  const sigstoreNamespaces = nss.filter((n) => n.labels[SIGSTORE_OPT_IN] === "true").map((n) => n.name).sort();
  const sigstore = input.sigstore.map(sigstoreSignaturePolicy).map((policy) => ({
    policy,
    scope: ((ns: Ns) => (ns.labels[SIGSTORE_OPT_IN] === "true" ? policy.mode : undefined)) as Scope,
  }));
  const engines = [
    ...input.kyverno.map(kyvernoSignaturePolicy).filter((x): x is NonNullable<typeof x> => x !== null),
    ...sigstore,
    ...(input.ratifyConstraints ?? []).map(ratifyPolicy),
    ...(input.validatingWebhooks ?? []).map(connaisseurPolicy).filter((x): x is NonNullable<typeof x> => x !== null),
  ];
  const policies = engines.map((e) => e.policy);

  const namespaces: NamespaceCoverage[] = nss.map((ns) => {
    const modes = engines.map((e) => e.scope(ns));
    const mode = modes.includes("enforce") ? "enforce" : modes.includes("audit") ? "audit" : "none";
    return { name: ns.name, mode, system: SYSTEM_NS.test(ns.name) };
  });
  const apps = namespaces.filter((n) => !n.system);
  const uncovered = apps.filter((n) => n.mode !== "enforce").map((n) => n.name);

  let status: ImageSignatureReport["status"];
  if (policies.length === 0) status = "none";
  else if (apps.length === 0) {
    // No namespace list to judge scope against: any enforcing policy counts.
    const enforced =
      engines.some((e) => e.policy.engine !== "sigstore" && e.policy.mode === "enforce") ||
      (sigstoreNamespaces.length > 0 && sigstore.some((e) => e.policy.mode === "enforce"));
    status = enforced ? "enforced" : "audit-only";
  } else if (uncovered.length === 0) status = "enforced";
  else status = apps.some((n) => n.mode === "enforce") ? "partial" : "audit-only";

  return { status, policies, sigstoreNamespaces, namespaces, uncovered };
}
