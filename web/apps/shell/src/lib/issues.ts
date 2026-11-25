import { findAttention } from "./attention";
import { certificateState } from "./certExpiry";
import { slugForKind, extSlug } from "./resources";
import { findServiceSelectorMismatches } from "./serviceSelectorMismatch";
import { targetFor } from "./objectPath";
import { computeSpofFindings } from "./spof";
import { findNetworkPolicyCoverageGaps } from "./networkPolicyCoverage";
import { computeBestPractices, type BestPracticesInput } from "./bestPractices";
import { applyExceptions, type BpException } from "./bestPracticesExceptions";
import { computeUpgradeReadiness } from "./upgradeReadiness";

/**
 * The Issues queue (backlog 76): one ranked list of what is wrong in a
 * cluster, built only from detectors that already exist. Pure: no React, no
 * fetches. Every issue names the detector that raised it and carries the
 * detector's own wording; nothing here invents a finding.
 */

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}
function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function ts(v: unknown): number | undefined {
  const t = Date.parse(str(v));
  return Number.isNaN(t) ? undefined : t;
}

export type IssueSeverity = "critical" | "high" | "medium" | "low";
export const ISSUE_SEVERITIES: IssueSeverity[] = ["critical", "high", "medium", "low"];

export type IssueDetector =
  | "pod-problem"
  | "node-condition"
  | "service-no-ready"
  | "cert-expiry"
  | "spof"
  | "netpol-gap"
  | "best-practice"
  | "upgrade-readiness";

/** Where each detector lives, for the page's "raised by" text. */
export const DETECTOR_LABEL: Record<IssueDetector, string> = {
  "pod-problem": "Needs attention",
  "node-condition": "Node conditions",
  "service-no-ready": "Service health",
  spof: "SPOF Radar",
  "netpol-gap": "Network policy coverage",
  "best-practice": "Best practices",
  "upgrade-readiness": "Upgrade readiness",
  "cert-expiry": "Certificates",
};

/** 0 = something is failing now; 1 = latent risk or hygiene. */
export const DETECTOR_TIER: Record<IssueDetector, 0 | 1> = {
  "pod-problem": 0,
  "node-condition": 0,
  "service-no-ready": 0,
  "cert-expiry": 0,
  spof: 1,
  "netpol-gap": 1,
  "best-practice": 1,
  "upgrade-readiness": 1,
};

export type IssueEvidence =
  | { open: "object"; slug: string; ns: string; name: string }
  | { open: "route"; path: string; search?: string };

export interface Issue {
  /** Stable: `${detector}|${kind}|${namespace}|${name}|${code}`. */
  id: string;
  cluster: string;
  detector: IssueDetector;
  /** The detector's own code, e.g. "CrashLoopBackOff". */
  code: string;
  severity: IssueSeverity;
  kind: string;
  /** "" for cluster-scoped objects. */
  namespace: string;
  name: string;
  /** One plain line, the detector's wording. Render as text only. */
  summary: string;
  /** ms epoch when known; age is now minus this. */
  since?: number;
  /** How many pods, endpoints or items it touches; at least 1. */
  blast: number;
  evidence: IssueEvidence;
}

export type UnavailableReason = "loading" | "forbidden" | "not-served";
export type NotCheckedReason = UnavailableReason | "error";
/** A list of rows, or why there are none to read. Undefined means still loading. */
export type Source = Obj[] | UnavailableReason | undefined;

export interface IssueInputs {
  pods?: Source;
  deployments?: Source;
  statefulsets?: Source;
  daemonsets?: Source;
  nodes?: Source;
  services?: Source;
  endpointSlices?: Source;
  certificates?: Source;
  pdbs?: Source;
  networkPolicies?: Source;
  /** The inputs the Best practices page computes its checks from. */
  bestPractices?: BestPracticesInput | UnavailableReason;
  /** The user's waivers for this cluster (local to this browser). */
  exceptions?: BpException[];
  /** The server version and the API group/versions it serves; both needed. */
  upgrade?: { serverVersion?: string; served?: string[] } | UnavailableReason;
  /** Epoch ms; defaults to now. */
  now?: number;
}

export interface IssuesResult {
  /** Ranked. */
  issues: Issue[];
  notChecked: { detector: IssueDetector; reason: NotCheckedReason }[];
  counts: Record<IssueSeverity, number>;
}

/** What a detector gives back: its issues, or why it could not look. */
export type DetectorResult = Issue[] | UnavailableReason;
export type DetectorFn = (cluster: string, input: IssueInputs, now: number) => DetectorResult;

type SourceName = "pods" | "deployments" | "statefulsets" | "daemonsets" | "nodes" | "services" | "endpointSlices" | "certificates" | "pdbs" | "networkPolicies";

/** The rows of every named source, or the first reason one of them is unavailable. */
function need<K extends SourceName>(input: IssueInputs, names: K[]): Record<K, Obj[]> | UnavailableReason {
  const out = {} as Record<K, Obj[]>;
  let reason: UnavailableReason | undefined;
  for (const n of names) {
    const s = input[n] as Source;
    if (Array.isArray(s)) out[n] = s;
    else if (!reason || s === "forbidden") reason = s ?? "loading";
    else if (reason === "loading" && s === "not-served") reason = s;
  }
  return reason ?? out;
}

function issue(cluster: string, p: Omit<Issue, "id" | "cluster">): Issue {
  return { id: `${p.detector}|${p.kind}|${p.namespace}|${p.name}|${p.code}`, cluster, ...p };
}

/** The object route for a Kind, or the workloads page when the app has no page for it. */
function evidenceFor(kind: string, ns: string, name: string, fallback = "/workloads"): IssueEvidence {
  const slug = slugForKind(kind);
  return slug ? { open: "object", slug, ns, name } : { open: "route", path: fallback };
}

/** Only these keep a service up; a lone pod or a Job with nothing ready is not an outage. */
const CONTROLLERS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);

function podProblems(cluster: string, input: IssueInputs, now: number): DetectorResult {
  const s = need(input, ["pods", "deployments", "statefulsets", "daemonsets", "nodes"]);
  if (typeof s === "string") return s;
  const rows = findAttention({ pods: s.pods, deployments: s.deployments, statefulSets: s.statefulsets, daemonSets: s.daemonsets, nodes: s.nodes, now });
  return rows.map((r) => {
    const wholeDown = r.severity === "err" && r.desired > 0 && r.ready === 0 && CONTROLLERS.has(r.kind);
    const worst = r.pods[0];
    let evidence: IssueEvidence;
    if (worst) {
      const i = worst.indexOf("/");
      evidence = { open: "object", slug: "pods", ns: worst.slice(0, i), name: worst.slice(i + 1) };
    } else evidence = evidenceFor(r.kind, r.namespace, r.name);
    const where = r.node ? ` on node ${r.node}` : "";
    return issue(cluster, {
      detector: "pod-problem",
      code: r.code,
      severity: r.severity === "warn" ? "medium" : wholeDown ? "critical" : "high",
      kind: r.kind,
      namespace: r.namespace,
      name: r.name,
      summary: `${r.plain} (${r.code})${where}, ${r.ready} of ${r.desired} ready`,
      since: r.since,
      blast: Math.max(1, r.pods.length),
      evidence,
    });
  });
}

const PRESSURE_WORDS: Record<string, string> = {
  MemoryPressure: "Short on memory",
  DiskPressure: "Short on disk",
  PIDPressure: "Running out of processes",
  NetworkUnavailable: "Network is not configured",
};

function nodeConditions(cluster: string, input: IssueInputs): DetectorResult {
  const s = need(input, ["nodes"]);
  if (typeof s === "string") return s;
  const out: Issue[] = [];
  for (const n of s.nodes) {
    const name = str(rec(n.metadata).name);
    const conds = arr(rec(n.status).conditions);
    const ready = conds.find((c) => c.type === "Ready");
    const base = { detector: "node-condition" as const, kind: "Node", namespace: "", name, blast: 1, evidence: { open: "object", slug: "nodes", ns: "", name } as IssueEvidence };
    if (ready && ready.status !== "True") {
      const why = str(ready.message) || str(ready.reason);
      out.push(issue(cluster, { ...base, code: "NodeNotReady", severity: "critical", summary: `Node is not Ready${why ? `: ${why}` : ""}`, since: ts(ready.lastTransitionTime) }));
    }
    for (const c of conds) {
      const t = str(c.type);
      if (!(t in PRESSURE_WORDS) || c.status !== "True") continue;
      out.push(issue(cluster, { ...base, code: t, severity: "medium", summary: `${PRESSURE_WORDS[t]} (${t})`, since: ts(c.lastTransitionTime) }));
    }
  }
  return out;
}

function serviceNoReady(cluster: string, input: IssueInputs): DetectorResult {
  const s = need(input, ["services", "pods", "endpointSlices"]);
  if (typeof s === "string") return s;
  return findServiceSelectorMismatches(s.services, s.pods, s.endpointSlices).map((f) =>
    issue(cluster, {
      detector: "service-no-ready",
      code: f.reason,
      severity: f.reason === "zero-ready-endpoints" ? "high" : "medium",
      kind: "Service",
      namespace: f.namespace,
      name: f.serviceName,
      summary:
        f.reason === "zero-ready-endpoints"
          ? "Its pods exist but none is ready to receive traffic"
          : "Its selector matches no pods, so it routes nowhere",
      blast: 1,
      evidence: { open: "object", slug: "services", ns: f.namespace, name: f.serviceName },
    }),
  );
}

const CERT_SLUG = extSlug("cert-manager.io/v1/certificates");
const CERT_ISSUE_GRACE_MS = 10 * 60_000;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function certExpiry(cluster: string, input: IssueInputs, now: number): DetectorResult {
  const s = need(input, ["certificates"]);
  if (typeof s === "string") return s;
  const out: Issue[] = [];
  for (const c of s.certificates) {
    const state = certificateState(c, now);
    if (state === "ok") continue;
    const meta = rec(c.metadata);
    const ns = str(meta.namespace);
    const name = str(meta.name);
    const st = rec(c.status);
    const exp = ts(st.notAfter);
    const ready = arr(st.conditions).find((x) => x.type === "Ready");
    const p = {
      detector: "cert-expiry" as const,
      kind: "Certificate",
      namespace: ns,
      name,
      blast: 1,
      evidence: { open: "object", slug: CERT_SLUG, ns, name } as IssueEvidence,
    };
    // A certificate still being issued is normal for a few minutes.
    if (state === "not-ready") {
      const since = ts(ready?.lastTransitionTime) ?? ts(meta.creationTimestamp);
      if (since !== undefined && now - since < CERT_ISSUE_GRACE_MS) continue;
    }
    if (state === "expired") out.push(issue(cluster, { ...p, code: "CertificateExpired", severity: "critical", summary: `Expired on ${day(exp!)}`, since: exp }));
    else if (state === "not-ready") out.push(issue(cluster, { ...p, code: "CertificateNotReady", severity: "high", summary: `Not Ready${str(ready?.message) ? `: ${str(ready?.message)}` : ""}`, since: ts(ready?.lastTransitionTime) }));
    else out.push(issue(cluster, { ...p, code: "CertificateExpiring", severity: "high", summary: `Expires on ${day(exp!)}` }));
  }
  return out;
}

function spof(cluster: string, input: IssueInputs): DetectorResult {
  const s = need(input, ["deployments", "statefulsets", "pdbs", "pods", "services", "endpointSlices"]);
  if (typeof s === "string") return s;
  return computeSpofFindings({ deployments: s.deployments, statefulSets: s.statefulsets, pdbs: s.pdbs, pods: s.pods, services: s.services, endpointSlices: s.endpointSlices }).map((f) =>
    issue(cluster, {
      detector: "spof",
      code: f.kind,
      severity: "medium",
      kind: f.workloadKind,
      namespace: f.ns,
      name: f.name,
      summary: f.detail,
      blast: 1,
      evidence: evidenceFor(f.workloadKind, f.ns, f.name),
    }),
  );
}

function netpolGaps(cluster: string, input: IssueInputs): DetectorResult {
  const s = need(input, ["pods", "networkPolicies"]);
  if (typeof s === "string") return s;
  return findNetworkPolicyCoverageGaps(s.pods, s.networkPolicies).map((g) =>
    issue(cluster, {
      detector: "netpol-gap",
      code: g.reason,
      severity: g.reason === "no-policy-in-namespace" ? "medium" : "low",
      kind: "Pods",
      namespace: g.namespace,
      name: `app=${g.appLabel}`,
      summary:
        g.reason === "no-policy-in-namespace"
          ? `${g.podCount} ${g.podCount === 1 ? "pod" : "pods"}, and no NetworkPolicy in this namespace`
          : `${g.podCount} ${g.podCount === 1 ? "pod" : "pods"} not selected by any NetworkPolicy`,
      // One group is one item; pod counts of different groups are not comparable with other detectors' blast.
      blast: 1,
      evidence: { open: "route", path: "/network-policy" },
    }),
  );
}

function bestPractice(cluster: string, input: IssueInputs): DetectorResult {
  const bp = input.bestPractices;
  if (bp === undefined) return "loading";
  if (typeof bp === "string") return bp;
  // The cert-expiry check is covered by the Certificates detector, which knows expired from expiring.
  const checks = applyExceptions(computeBestPractices(bp), input.exceptions ?? []);
  return checks
    .filter((c) => c.status === "fail" && c.severity === "Critical" && c.id !== "cert-expiry")
    .map((c) =>
      issue(cluster, {
        detector: "best-practice",
        code: c.id,
        severity: "critical",
        kind: "Best practice",
        namespace: c.namespaces?.length === 1 ? c.namespaces[0]! : "",
        name: c.title,
        summary: c.detail,
        blast: Math.max(1, c.allOffenders?.length ?? c.offenders?.length ?? 1),
        evidence: { open: "route", path: "/best-practices" },
      }),
    );
}

function upgradeReadiness(cluster: string, input: IssueInputs): DetectorResult {
  const u = input.upgrade;
  if (u === undefined) return "loading";
  if (typeof u === "string") return u;
  if (!u.serverVersion || !u.served) return "loading";
  return computeUpgradeReadiness(u.serverVersion, u.served).map((f) =>
    issue(cluster, {
      detector: "upgrade-readiness",
      code: `removed-in-1.${f.removedInMinor}`,
      severity: f.minorsAway <= 1 ? "high" : "medium",
      kind: "API",
      namespace: "",
      name: `${f.kind} ${f.apiVersion}`,
      summary: `${f.apiVersion} is removed in Kubernetes 1.${f.removedInMinor}${f.minorsAway > 0 ? ` (${f.minorsAway} ${f.minorsAway === 1 ? "minor" : "minors"} away)` : ""}; use ${f.replacementVersion}`,
      blast: 1,
      evidence: { open: "route", path: "/upgrade-readiness" },
    }),
  );
}

export const detectors: Record<IssueDetector, DetectorFn> = {
  spof,
  "netpol-gap": netpolGaps,
  "best-practice": bestPractice,
  "upgrade-readiness": upgradeReadiness,
  "pod-problem": podProblems,
  "node-condition": nodeConditions,
  "service-no-ready": serviceNoReady,
  "cert-expiry": certExpiry,
};

const SEV_RANK: Record<IssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Severity, then failing-now before latent risk, then blast, then oldest first (unknown age last), then id. */
export function rankIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
      DETECTOR_TIER[a.detector] - DETECTOR_TIER[b.detector] ||
      b.blast - a.blast ||
      (a.since ?? Infinity) - (b.since ?? Infinity) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export interface IssueFilter {
  severity?: IssueSeverity[];
  kind?: string[];
  namespace?: string[];
}

export function filterIssues(issues: Issue[], f: IssueFilter): Issue[] {
  return issues.filter(
    (i) =>
      (!f.severity?.length || f.severity.includes(i.severity)) &&
      (!f.kind?.length || f.kind.includes(i.kind)) &&
      (!f.namespace?.length || f.namespace.includes(i.namespace)),
  );
}

/** The router path Investigate opens. */
export function issueTarget(i: Issue): string {
  const e = i.evidence;
  return e.open === "object" ? targetFor({ slug: e.slug, ns: e.ns, name: e.name }) : `${e.path}${e.search ?? ""}`;
}

export function countBySeverity(issues: Issue[]): Record<IssueSeverity, number> {
  const counts: Record<IssueSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues) counts[i.severity]++;
  return counts;
}

export type DetectorOutcome = { issues: Issue[] } | { reason: NotCheckedReason };

/** Runs one detector in isolation: a throw becomes "not checked (error)". */
export function runDetector(id: IssueDetector, cluster: string, input: IssueInputs, now: number, fn: DetectorFn = detectors[id]): DetectorOutcome {
  try {
    const r = fn(cluster, input, now);
    return typeof r === "string" ? { reason: r } : { issues: r };
  } catch {
    return { reason: "error" };
  }
}

/** Joins per-detector outcomes into the ranked result the page shows. */
export function assembleIssues(outcomes: Partial<Record<IssueDetector, DetectorOutcome>>): IssuesResult {
  const issues: Issue[] = [];
  const notChecked: IssuesResult["notChecked"] = [];
  for (const id of Object.keys(detectors) as IssueDetector[]) {
    const o = outcomes[id] ?? { reason: "loading" as const };
    if ("issues" in o) issues.push(...o.issues);
    else notChecked.push({ detector: id, reason: o.reason });
  }
  const ranked = rankIssues(issues);
  return { issues: ranked, notChecked, counts: countBySeverity(ranked) };
}

/**
 * Runs every detector, each isolated: one that throws is reported as not
 * checked and the rest still count. A detector that cannot read its sources
 * is "not checked", never "no issues".
 */
export function computeIssues(cluster: string, input: IssueInputs, override: Partial<Record<IssueDetector, DetectorFn>> = {}): IssuesResult {
  const now = input.now ?? Date.now();
  const outcomes: Partial<Record<IssueDetector, DetectorOutcome>> = {};
  for (const id of Object.keys(detectors) as IssueDetector[]) outcomes[id] = runDetector(id, cluster, input, now, override[id] ?? detectors[id]);
  return assembleIssues(outcomes);
}
