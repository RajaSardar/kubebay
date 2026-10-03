import type { RBACFinding, RBACRule, RBACSnapshot } from "./api";
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
 *
 * v2: entries also come from Gateway API HTTPRoutes. A NetworkPolicy counts
 * as restricting only when its rules leave out where the traffic comes from
 * (the ingress controller or Gateway proxy pods, or outside the cluster for
 * LoadBalancer and NodePort). Payoffs also include breaking out to the node
 * (a privileged container or a hostPath volume) and the Secrets the mounted
 * token can read, resolved from the RBAC snapshot.
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
  /** Namespace objects, for NetworkPolicy namespaceSelectors. */
  namespaces?: Obj[];
  /** Gateway API HTTPRoutes; empty when the CRD isn't installed. */
  httpRoutes?: Obj[];
  /** Roles and bindings, to resolve which Secrets a token can read. */
  rbac?: Pick<RBACSnapshot, "roles" | "clusterRoles" | "roleBindings" | "clusterRoleBindings">;
}

export type AttackPathRule = RBACRule;

export interface AttackEntry {
  via: "LoadBalancer" | "NodePort" | "Ingress" | "Gateway";
  name: string;
  /** "ns/name" of the Gateway an HTTPRoute attaches to. */
  gateway?: string;
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
  /** How a container can reach the node: privileged containers, hostPath mounts. */
  nodeEscape: string[];
  /** Secrets the mounted token can read: "every namespace", a namespace, or "ns/name". */
  secretAccess: string[];
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
  for (const route of input.httpRoutes ?? []) {
    const routeNs = nsOf(route);
    const spec = rec(route.spec);
    const hit = arr(spec.rules).some((r) =>
      arr(r.backendRefs).some(
        (b) => (str(b.kind) || "Service") === "Service" && !str(b.group) && (str(b.namespace) || routeNs) === nsOf(pod) && selectingNames.has(str(b.name)),
      ),
    );
    if (!hit) continue;
    const hosts = Array.isArray(spec.hostnames) ? (spec.hostnames as unknown[]).map(str).filter(Boolean) : [];
    for (const parent of arr(spec.parentRefs)) {
      if ((str(parent.kind) || "Gateway") !== "Gateway") continue;
      out.push({
        via: "Gateway",
        name: nameOf(route),
        gateway: `${str(parent.namespace) || routeNs}/${str(parent.name)}`,
        ...(hosts.length ? { detail: hosts.join(", ") } : {}),
      });
    }
  }
  return out;
}

function selectingPolicies(pod: Obj, policies: Obj[]): Obj[] {
  return policies.filter((p) => {
    if (nsOf(p) !== nsOf(pod)) return false;
    const spec = rec(p.spec);
    const types = Array.isArray(spec.policyTypes) ? (spec.policyTypes as string[]) : ["Ingress"];
    return types.includes("Ingress") && matchesSelector(labels(pod), rec(spec.podSelector) as LabelSelector);
  });
}

// Pods that forward Ingress traffic: the common controllers' standard labels.
const INGRESS_CONTROLLERS = new Set(["ingress-nginx", "nginx-ingress", "traefik", "haproxy-ingress", "kubernetes-ingress", "kong", "contour", "envoy", "istio-ingressgateway"]);

function ingressControllerPods(pods: Obj[]): Obj[] {
  return pods.filter((p) => {
    const l = labels(p);
    return INGRESS_CONTROLLERS.has(l["app.kubernetes.io/name"] ?? "") || INGRESS_CONTROLLERS.has(l.app ?? "");
  });
}

/** Proxy pods of a Gateway "ns/name": Istio/kgateway and Envoy Gateway label them. */
function gatewayPods(pods: Obj[], gateway: string): Obj[] {
  const [ns, name] = gateway.split("/");
  return pods.filter((p) => {
    const l = labels(p);
    return (
      (l["gateway.networking.k8s.io/gateway-name"] === name && nsOf(p) === ns) ||
      (l["gateway.envoyproxy.io/owning-gateway-name"] === name && l["gateway.envoyproxy.io/owning-gateway-namespace"] === ns)
    );
  });
}

function ipv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!/^\d+$/.test(part) || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** null when either side isn't IPv4: the caller then can't rule the peer out. */
function inCidr(ip: string, cidr: string): boolean | null {
  const [base, bits] = cidr.split("/");
  const a = ipv4(ip);
  const b = ipv4(base ?? "");
  const n = Number(bits);
  if (a == null || b == null || !Number.isInteger(n) || n < 0 || n > 32) return null;
  const size = 2 ** (32 - n);
  return Math.floor(a / size) === Math.floor(b / size);
}

function peerAdmitsPod(peer: Obj, policyNs: string, src: Obj, nsLabels: (ns: string) => Record<string, string>): boolean {
  const block = rec(peer.ipBlock);
  if (Object.keys(block).length) {
    const ip = str(rec(src.status).podIP);
    const inside = inCidr(ip, str(block.cidr));
    if (inside === false) return false;
    const excepted = (Array.isArray(block.except) ? (block.except as unknown[]).map(str) : []).some((c) => inCidr(ip, c) === true);
    return !excepted;
  }
  const nsSel = peer.namespaceSelector;
  const nsOk = nsSel ? matchesSelector(nsLabels(nsOf(src)), rec(nsSel) as LabelSelector) : nsOf(src) === policyNs;
  const podOk = peer.podSelector ? matchesSelector(labels(src), rec(peer.podSelector) as LabelSelector) : true;
  return nsOk && podOk;
}

type Admission = "admits" | "unknown" | "denies";

/** Whether a policy's ingress rules let in the traffic an entry delivers. Ports are not considered. */
function admission(policy: Obj, e: AttackEntry, input: AttackPathInput, nsLabels: (ns: string) => Record<string, string>): Admission {
  const rules = arr(rec(policy.spec).ingress);
  const fromOf = (r: Obj) => (Array.isArray(r.from) ? arr(r.from) : []);
  if (rules.some((r) => fromOf(r).length === 0)) return "admits";
  if (e.via === "LoadBalancer" || e.via === "NodePort") {
    // Client and node addresses aren't known here, so any ipBlock may cover them.
    return rules.some((r) => fromOf(r).some((p) => Object.keys(rec(p.ipBlock)).length > 0)) ? "admits" : "denies";
  }
  const sources = e.via === "Ingress" ? ingressControllerPods(input.pods) : gatewayPods(input.pods, e.gateway ?? "");
  if (sources.length === 0) return rules.length === 0 ? "denies" : "unknown";
  return rules.some((r) => fromOf(r).some((p) => sources.some((src) => peerAdmitsPod(p, nsOf(policy), src, nsLabels)))) ? "admits" : "denies";
}

function sourceName(e: AttackEntry): string {
  if (e.via === "Ingress") return "the ingress controller";
  if (e.via === "Gateway") return "the Gateway's proxy";
  return "outside the cluster";
}

// Node breakout: what lets a compromised container reach its node.
function nodeEscapes(spec: Obj): string[] {
  const out: string[] = [];
  for (const c of [...arr(spec.initContainers), ...arr(spec.containers)]) {
    if (rec(c.securityContext).privileged === true) out.push(`privileged container ${str(c.name)}`);
  }
  for (const v of arr(spec.volumes)) {
    const path = str(rec(v.hostPath).path);
    if (path) out.push(`hostPath ${path}`);
  }
  return out;
}

const READ_VERBS = ["get", "list", "watch", "*"];

function readsSecrets(r: RBACRule): boolean {
  return r.verbs.some((v) => READ_VERBS.includes(v)) && (r.apiGroups.includes("") || r.apiGroups.includes("*")) && (r.resources.includes("secrets") || r.resources.includes("*"));
}

/** Secrets the ServiceAccount "ns/name" can read through its bindings, groups included. */
function secretAccess(sa: string, rbac: AttackPathInput["rbac"]): string[] {
  if (!rbac) return [];
  const [saNs, saName] = sa.split("/");
  const isMe = (s: { kind: string; name: string; ns?: string }, bindingNs?: string) =>
    (s.kind === "ServiceAccount" && s.name === saName && (s.ns || bindingNs) === saNs) ||
    (s.kind === "User" && s.name === `system:serviceaccount:${saNs}:${saName}`) ||
    (s.kind === "Group" && ["system:serviceaccounts", `system:serviceaccounts:${saNs}`, "system:authenticated"].includes(s.name));
  const rulesOf = (roleRef: string, ns?: string): RBACRule[] => {
    const [kind, name] = roleRef.split(":");
    const role = kind === "ClusterRole" ? rbac.clusterRoles.find((r) => r.name === name) : rbac.roles.find((r) => r.name === name && r.ns === ns);
    return role?.rules ?? [];
  };
  const out: string[] = [];
  const add = (v: string) => {
    if (!out.includes(v)) out.push(v);
  };
  for (const b of rbac.clusterRoleBindings) {
    if (b.subjects.some((s) => isMe(s)) && rulesOf(b.roleRef).some(readsSecrets)) return ["every namespace"];
  }
  for (const b of rbac.roleBindings) {
    if (!b.subjects.some((s) => isMe(s, b.ns))) continue;
    for (const r of rulesOf(b.roleRef, b.ns).filter(readsSecrets)) {
      if (r.resourceNames?.length) r.resourceNames.forEach((n) => add(`${b.ns}/${n}`));
      else add(b.ns ?? "");
    }
  }
  return out;
}

function describeEntry(e: AttackEntry, ns: string): string {
  if (e.via === "Ingress") return `Ingress ${ns}/${e.name}${e.detail ? ` (${e.detail})` : ""}`;
  if (e.via === "Gateway") return `HTTPRoute ${ns}/${e.name} on Gateway ${e.gateway}${e.detail ? ` (${e.detail})` : ""}`;
  return `${e.via} Service ${ns}/${e.name}`;
}

const ENTRY_WEIGHT: Record<AttackEntry["via"], number> = { LoadBalancer: 2, Ingress: 2, Gateway: 2, NodePort: 1 };

// Worst first: what one pod of a workload allows, the workload allows.
const ISOLATION_ORDER = ["open", "admits", "unknown", "restricted"] as const;
type Isolation = (typeof ISOLATION_ORDER)[number];

export function findAttackPaths(input: AttackPathInput): AttackPath[] {
  interface Acc {
    workload: AttackPath["workload"];
    serviceAccount: string;
    entry: Map<string, AttackEntry>;
    isolating: Set<string>;
    isolation: Isolation;
    admittedFrom: Set<string>;
    unknownFrom: Set<string>;
    cves: Map<string, string>;
    tokenMounted: boolean;
    nodeEscape: Set<string>;
  }
  const byWorkload = new Map<string, Acc>();
  const nsByName = new Map((input.namespaces ?? []).map((n) => [nameOf(n), labels(n)]));
  // Namespaces carry this label automatically, so it holds even unstreamed.
  const nsLabels = (ns: string) => ({ "kubernetes.io/metadata.name": ns, ...(nsByName.get(ns) ?? {}) });

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
      ({
        workload: { ns, kind: w.kind, name: w.name },
        serviceAccount: sa,
        entry: new Map(),
        isolating: new Set(),
        isolation: "restricted",
        admittedFrom: new Set(),
        unknownFrom: new Set(),
        cves: new Map(),
        tokenMounted: false,
        nodeEscape: new Set(),
      } as Acc);
    for (const e of entries) acc.entry.set(`${e.via}/${e.name}/${e.gateway ?? ""}`, e);
    const policies = selectingPolicies(pod, input.networkPolicies);
    policies.forEach((p) => acc.isolating.add(`${nsOf(p)}/${nameOf(p)}`));
    let podIso: Isolation = policies.length === 0 ? "open" : "restricted";
    for (const e of policies.length ? entries : []) {
      const verdicts = policies.map((p) => admission(p, e, input, nsLabels));
      if (verdicts.includes("admits")) {
        acc.admittedFrom.add(sourceName(e));
        podIso = "admits";
      } else if (verdicts.includes("unknown")) {
        acc.unknownFrom.add(sourceName(e));
        if (podIso === "restricted") podIso = "unknown";
      }
    }
    if (ISOLATION_ORDER.indexOf(podIso) < ISOLATION_ORDER.indexOf(acc.isolation)) acc.isolation = podIso;
    nodeEscapes(spec).forEach((x) => acc.nodeEscape.add(x));
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
    const nodeEscape = [...acc.nodeEscape];
    const secrets = acc.tokenMounted ? secretAccess(acc.serviceAccount, input.rbac) : [];
    const foothold = critical + high > 0;
    const payoff = privileges.length > 0 || nodeEscape.length > 0 || secrets.length > 0;
    if (!foothold && !payoff) continue;

    const entry = [...acc.entry.values()];
    const ns = acc.workload.ns;
    const isolated = acc.isolation === "restricted";
    const isolatingPolicies = [...acc.isolating].sort();
    const policyList = isolatingPolicies.join(", ");
    const steps = [`Reachable from outside the cluster via ${entry.map((e) => describeEntry(e, ns)).join(", ")}`];
    steps.push(
      acc.isolation === "open"
        ? "No NetworkPolicy restricts ingress to these pods"
        : acc.isolation === "admits"
          ? `NetworkPolicy ${policyList} selects these pods but admits traffic from ${[...acc.admittedFrom].join(" and ")}`
          : acc.isolation === "unknown"
            ? `NetworkPolicy ${policyList} selects these pods, but ${[...acc.unknownFrom].map((x) => `${x}'s pods`).join(" and ")} weren't found to check it`
            : `Ingress is restricted by NetworkPolicy ${policyList}`,
    );
    if (foothold) {
      const parts = [critical ? `${critical} critical` : "", high ? `${high} high` : ""].filter(Boolean);
      steps.push(`Runs images with ${parts.join(" and ")} CVE${critical + high === 1 ? "" : "s"}`);
    }
    if (nodeEscape.length) steps.push(`Can break out to the node: ${nodeEscape.join("; ")}`);
    if (privileges.length) {
      steps.push(`Mounts the ${acc.serviceAccount} ServiceAccount token. RBAC findings for it: ${privileges.map((p) => p.title).join("; ")}`);
    }
    if (secrets.length) {
      steps.push(secrets[0] === "every namespace" ? "The token can read Secrets in every namespace" : `The token can read Secrets: ${secrets.join(", ")}`);
    }

    const severePayoff = nodeEscape.length > 0 || secrets[0] === "every namespace" || privileges.some((p) => p.severity === "high");
    const score =
      Math.max(...entry.map((e) => ENTRY_WEIGHT[e.via])) +
      (isolated ? 0 : 1) +
      (critical ? 3 : high ? 2 : 0) +
      (severePayoff ? 3 : payoff ? 1 : 0);
    out.push({
      workload: acc.workload,
      serviceAccount: acc.serviceAccount,
      entry,
      ingressIsolated: isolated,
      isolatingPolicies,
      vulns: { critical, high },
      tokenMounted: acc.tokenMounted,
      privileges,
      nodeEscape,
      secretAccess: secrets,
      complete: foothold && payoff,
      score,
      steps,
    });
  }

  const ident = (p: AttackPath) => `${p.workload.ns}/${p.workload.kind}/${p.workload.name}`;
  return out.sort((a, b) => Number(b.complete) - Number(a.complete) || b.score - a.score || ident(a).localeCompare(ident(b)));
}
