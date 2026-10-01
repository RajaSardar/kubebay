import type { RBACFinding } from "./api";
import { matchesSelector, type LabelSelector } from "./labelSelector";
import { controllerOwner } from "./podOwner";
import { findingsForPod } from "./vulnFindings";

/**
 * Intelligence roadmap Tier 3 #24, narrow v1: join findings Kubebay already
 * has into prioritised chains instead of a flat list. A chain starts where
 * traffic from outside the cluster lands (a LoadBalancer or NodePort Service,
 * or an Ingress backend), then asks whether NetworkPolicy limits it, whether
 * the pods run images with critical or high CVEs (a foothold), and whether
 * their mounted ServiceAccount token carries risky RBAC (a payoff).
 * Exposure alone is not a path: it needs a foothold or a payoff.
 */

type Obj = Record<string, unknown>;

export interface AttackPathInput {
  pods: Obj[];
  services: Obj[];
  ingresses: Obj[];
  networkPolicies: Obj[];
  /** Trivy-Operator VulnerabilityReports; empty when Trivy isn't installed. */
  vulnReports: Obj[];
  rbacFindings: RBACFinding[];
}

export interface AttackEntry {
  via: "LoadBalancer" | "NodePort" | "Ingress";
  name: string;
  detail?: string;
}

export interface AttackPath {
  workload: { ns: string; kind: string; name: string };
  serviceAccount: string;
  entry: AttackEntry[];
  ingressIsolated: boolean;
  isolatingPolicies: string[];
  vulns: { critical: number; high: number };
  tokenMounted: boolean;
  privileges: { title: string; severity: "high" | "medium"; roleRef: string }[];
  /** Foothold and payoff both present. */
  complete: boolean;
  score: number;
  steps: string[];
}

const NOT_A_PRIVILEGE = new Set(["ServiceAccount subject does not exist"]);

function rec(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}
function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? v.map(rec) : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function labels(o: Obj): Record<string, string> {
  return rec(rec(o.metadata).labels) as Record<string, string>;
}
function nsOf(o: Obj): string {
  return str(rec(o.metadata).namespace);
}
function nameOf(o: Obj): string {
  return str(rec(o.metadata).name);
}

function workloadOf(pod: Obj): { kind: string; name: string; ownerKind: string; ownerName: string } {
  const owner = controllerOwner(pod);
  if (!owner) return { kind: "Pod", name: nameOf(pod), ownerKind: "Pod", ownerName: nameOf(pod) };
  if (owner.kind === "ReplicaSet") {
    const hash = labels(pod)["pod-template-hash"];
    if (hash && owner.name.endsWith(`-${hash}`)) {
      return { kind: "Deployment", name: owner.name.slice(0, -hash.length - 1), ownerKind: owner.kind, ownerName: owner.name };
    }
  }
  return { kind: owner.kind, name: owner.name, ownerKind: owner.kind, ownerName: owner.name };
}

function selects(service: Obj, pod: Obj): boolean {
  const selector = rec(rec(service.spec).selector) as Record<string, string>;
  if (Object.keys(selector).length === 0 || nsOf(service) !== nsOf(pod)) return false;
  return matchesSelector(labels(pod), { matchLabels: selector });
}

function ingressBackends(ing: Obj): { service: string; host: string }[] {
  const spec = rec(ing.spec);
  const out: { service: string; host: string }[] = [];
  const def = str(rec(rec(spec.defaultBackend).service).name);
  if (def) out.push({ service: def, host: "" });
  for (const rule of arr(spec.rules)) {
    const host = str(rule.host);
    for (const path of arr(rec(rule.http).paths)) {
      const service = str(rec(rec(path.backend).service).name);
      if (service) out.push({ service, host });
    }
  }
  return out;
}

function entriesFor(pod: Obj, input: AttackPathInput): AttackEntry[] {
  const out: AttackEntry[] = [];
  const selecting = input.services.filter((s) => selects(s, pod));
  for (const s of selecting) {
    const type = str(rec(s.spec).type);
    if (type === "LoadBalancer" || type === "NodePort") out.push({ via: type, name: nameOf(s) });
  }
  const selectingNames = new Set(selecting.map(nameOf));
  for (const ing of input.ingresses) {
    if (nsOf(ing) !== nsOf(pod)) continue;
    const hit = ingressBackends(ing).filter((b) => selectingNames.has(b.service));
    if (hit.length === 0) continue;
    const hosts = [...new Set(hit.map((b) => b.host).filter(Boolean))];
    out.push({ via: "Ingress", name: nameOf(ing), ...(hosts.length ? { detail: hosts.join(", ") } : {}) });
  }
  return out;
}

function isolatingPolicies(pod: Obj, policies: Obj[]): string[] {
  return policies
    .filter((p) => {
      if (nsOf(p) !== nsOf(pod)) return false;
      const spec = rec(p.spec);
      const types = Array.isArray(spec.policyTypes) ? (spec.policyTypes as string[]) : ["Ingress"];
      return types.includes("Ingress") && matchesSelector(labels(pod), rec(spec.podSelector) as LabelSelector);
    })
    .map((p) => `${nsOf(p)}/${nameOf(p)}`);
}

function describeEntry(e: AttackEntry, ns: string): string {
  if (e.via === "Ingress") return `Ingress ${ns}/${e.name}${e.detail ? ` (${e.detail})` : ""}`;
  return `${e.via} Service ${ns}/${e.name}`;
}

const ENTRY_WEIGHT: Record<AttackEntry["via"], number> = { LoadBalancer: 2, Ingress: 2, NodePort: 1 };

export function findAttackPaths(input: AttackPathInput): AttackPath[] {
  interface Acc {
    workload: AttackPath["workload"];
    serviceAccount: string;
    entry: Map<string, AttackEntry>;
    isolating: Set<string>;
    allIsolated: boolean;
    cves: Map<string, string>;
    tokenMounted: boolean;
  }
  const byWorkload = new Map<string, Acc>();

  for (const pod of input.pods) {
    const entries = entriesFor(pod, input);
    if (entries.length === 0) continue;
    const ns = nsOf(pod);
    const w = workloadOf(pod);
    const spec = rec(pod.spec);
    const sa = `${ns}/${str(spec.serviceAccountName) || "default"}`;
    const key = `${ns}/${w.kind}/${w.name}/${sa}`;
    const acc =
      byWorkload.get(key) ??
      ({ workload: { ns, kind: w.kind, name: w.name }, serviceAccount: sa, entry: new Map(), isolating: new Set(), allIsolated: true, cves: new Map(), tokenMounted: false } as Acc);
    for (const e of entries) acc.entry.set(`${e.via}/${e.name}`, e);
    const iso = isolatingPolicies(pod, input.networkPolicies);
    if (iso.length === 0) acc.allIsolated = false;
    iso.forEach((p) => acc.isolating.add(p));
    const containers = arr(spec.containers).map((c) => str(c.name));
    for (const f of findingsForPod(input.vulnReports, { ns, ownerKind: w.ownerKind, ownerName: w.ownerName, containers })) {
      acc.cves.set(`${f.container}/${f.id}`, f.severity);
    }
    if (spec.automountServiceAccountToken !== false) acc.tokenMounted = true;
    byWorkload.set(key, acc);
  }

  const out: AttackPath[] = [];
  for (const acc of byWorkload.values()) {
    const critical = [...acc.cves.values()].filter((s) => s === "CRITICAL").length;
    const high = [...acc.cves.values()].filter((s) => s === "HIGH").length;
    const privileges: AttackPath["privileges"] = [];
    if (acc.tokenMounted) {
      for (const f of input.rbacFindings) {
        if (f.subject !== `ServiceAccount ${acc.serviceAccount}` || NOT_A_PRIVILEGE.has(f.title)) continue;
        if (privileges.some((p) => p.title === f.title)) continue;
        privileges.push({ title: f.title, severity: f.severity, roleRef: f.roleRef });
      }
    }
    const foothold = critical + high > 0;
    const payoff = privileges.length > 0;
    if (!foothold && !payoff) continue;

    const entry = [...acc.entry.values()];
    const ns = acc.workload.ns;
    const isolated = acc.allIsolated;
    const isolatingPolicies = [...acc.isolating].sort();
    const steps = [`Reachable from outside the cluster via ${entry.map((e) => describeEntry(e, ns)).join(", ")}`];
    steps.push(isolated ? `Ingress is restricted by NetworkPolicy ${isolatingPolicies.join(", ")}` : "No NetworkPolicy restricts ingress to these pods");
    if (foothold) {
      const parts = [critical ? `${critical} critical` : "", high ? `${high} high` : ""].filter(Boolean);
      steps.push(`Runs images with ${parts.join(" and ")} CVE${critical + high === 1 ? "" : "s"}`);
    }
    if (payoff) {
      steps.push(`Mounts the ${acc.serviceAccount} ServiceAccount token. RBAC findings for it: ${privileges.map((p) => p.title).join("; ")}`);
    }

    const score =
      Math.max(...entry.map((e) => ENTRY_WEIGHT[e.via])) +
      (isolated ? 0 : 1) +
      (critical ? 3 : high ? 2 : 0) +
      (privileges.some((p) => p.severity === "high") ? 3 : payoff ? 1 : 0);
    out.push({
      workload: acc.workload,
      serviceAccount: acc.serviceAccount,
      entry,
      ingressIsolated: isolated,
      isolatingPolicies,
      vulns: { critical, high },
      tokenMounted: acc.tokenMounted,
      privileges,
      complete: foothold && payoff,
      score,
      steps,
    });
  }

  const ident = (p: AttackPath) => `${p.workload.ns}/${p.workload.kind}/${p.workload.name}`;
  return out.sort((a, b) => Number(b.complete) - Number(a.complete) || b.score - a.score || ident(a).localeCompare(ident(b)));
}
