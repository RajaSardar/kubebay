import { evaluateConnection } from "./netpolEval";
import { matchesSelector } from "./labelSelector";

/**
 * NetworkPolicy visual editor (Intelligence roadmap Tier 2 #22): a form
 * draft becomes a NetworkPolicy object, and its impact is previewed against
 * the live pods with #39's evaluator before anything reaches the cluster.
 */

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export type PeerDraft =
  | { kind: "pods"; namespace?: string; labels: string }
  | { kind: "namespace"; namespace: string }
  | { kind: "cidr"; cidr: string };

export interface RuleDraft {
  peer: PeerDraft;
  /** "8080, 53/UDP"; empty means every port. */
  ports: string;
}

export interface PolicyDraft {
  name: string;
  namespace: string;
  /** "app=web, tier=frontend"; empty selects every pod in the namespace. */
  podLabels: string;
  /** null leaves the direction unrestricted; [] denies all of it. */
  ingress: RuleDraft[] | null;
  egress: RuleDraft[] | null;
  /** When egress is restricted, also allow DNS to kube-system's kube-dns. */
  allowDns: boolean;
}

export function parseLabels(s: string): { ok: true; labels: Record<string, string> } | { ok: false; error: string } {
  const labels: Record<string, string> = {};
  for (const part of s.split(",").map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf("=");
    if (i <= 0 || i === part.length - 1) return { ok: false, error: `expected key=value, got "${part}"` };
    labels[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return { ok: true, labels };
}

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const NS_KEY = "kubernetes.io/metadata.name";

function selector(labels: Record<string, string>): Obj {
  return Object.keys(labels).length > 0 ? { matchLabels: labels } : {};
}

function parsePorts(s: string): Obj[] | string {
  const out: Obj[] = [];
  for (const part of s.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d{1,5})(?:\/(TCP|UDP|SCTP))?$/i.exec(part);
    const port = m ? Number(m[1]) : 0;
    if (!m || port < 1 || port > 65535) return `Bad port "${part}": use a number, optionally /TCP, /UDP or /SCTP.`;
    out.push({ protocol: (m[2] ?? "TCP").toUpperCase(), port });
  }
  return out;
}

function validCidr(c: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(c.trim());
  if (m) return m.slice(1, 5).every((o) => Number(o) <= 255) && Number(m[5]) <= 32;
  return /^[0-9a-fA-F:]+\/\d{1,3}$/.test(c.trim()) && c.includes(":");
}

function peerEntry(peer: PeerDraft, policyNs: string): Obj | string {
  if (peer.kind === "cidr") return validCidr(peer.cidr) ? { ipBlock: { cidr: peer.cidr.trim() } } : `Bad CIDR "${peer.cidr}".`;
  if (peer.kind === "namespace") {
    if (!DNS_LABEL.test(peer.namespace)) return `Bad namespace "${peer.namespace}".`;
    return { namespaceSelector: { matchLabels: { [NS_KEY]: peer.namespace } } };
  }
  const l = parseLabels(peer.labels);
  if (!l.ok) return `Peer labels: ${l.error}`;
  const ns = peer.namespace?.trim();
  if (!ns || ns === policyNs) return { podSelector: selector(l.labels) };
  if (!DNS_LABEL.test(ns)) return `Bad namespace "${ns}".`;
  return { namespaceSelector: { matchLabels: { [NS_KEY]: ns } }, podSelector: selector(l.labels) };
}

function buildRules(rules: RuleDraft[], key: "from" | "to", ns: string): Obj[] | string {
  const out: Obj[] = [];
  for (const r of rules) {
    const peer = peerEntry(r.peer, ns);
    if (typeof peer === "string") return peer;
    const ports = parsePorts(r.ports);
    if (typeof ports === "string") return ports;
    out.push(ports.length > 0 ? { [key]: [peer], ports } : { [key]: [peer] });
  }
  return out;
}

export function draftToPolicy(d: PolicyDraft): { ok: true; policy: Obj } | { ok: false; error: string } {
  if (!DNS_LABEL.test(d.name) || d.name.length > 63) return { ok: false, error: "Name must be a lowercase DNS label." };
  if (!d.namespace) return { ok: false, error: "Pick a namespace." };
  if (d.ingress === null && d.egress === null) return { ok: false, error: "Restrict ingress, egress or both." };
  const pods = parseLabels(d.podLabels);
  if (!pods.ok) return { ok: false, error: `Pod labels: ${pods.error}` };

  const spec: Obj = { podSelector: selector(pods.labels), policyTypes: [] as string[] };
  const types = spec.policyTypes as string[];
  if (d.ingress !== null) {
    const ingress = buildRules(d.ingress, "from", d.namespace);
    if (typeof ingress === "string") return { ok: false, error: ingress };
    types.push("Ingress");
    spec.ingress = ingress;
  }
  if (d.egress !== null) {
    const egress = buildRules(d.egress, "to", d.namespace);
    if (typeof egress === "string") return { ok: false, error: egress };
    if (d.allowDns) {
      egress.push({
        to: [{ namespaceSelector: { matchLabels: { [NS_KEY]: "kube-system" } }, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }],
        ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }],
      });
    }
    types.push("Egress");
    spec.egress = egress;
  }
  return {
    ok: true,
    policy: { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name: d.name, namespace: d.namespace }, spec },
  };
}

// ── A small YAML emitter for plain JSON-shaped objects ──────────────────────

function scalar(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === null || v === undefined) return "null";
  return String(v);
}
function yamlKey(k: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(k) ? k : JSON.stringify(k);
}
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function emitMap(o: Obj, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${pad}${yamlKey(k)}: []`);
      else lines.push(`${pad}${yamlKey(k)}:`, ...emitList(v, indent + 2));
    } else if (isObj(v)) {
      if (Object.keys(v).length === 0) lines.push(`${pad}${yamlKey(k)}: {}`);
      else lines.push(`${pad}${yamlKey(k)}:`, ...emitMap(v, indent + 2));
    } else {
      lines.push(`${pad}${yamlKey(k)}: ${scalar(v)}`);
    }
  }
  return lines;
}

function emitList(a: unknown[], indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const item of a) {
    if (isObj(item) && Object.keys(item).length > 0) {
      const sub = emitMap(item, indent + 2);
      sub[0] = `${pad}- ${sub[0]!.slice(indent + 2)}`;
      lines.push(...sub);
    } else if (Array.isArray(item) && item.length > 0) {
      lines.push(`${pad}-`, ...emitList(item, indent + 2));
    } else if (isObj(item)) {
      lines.push(`${pad}- {}`);
    } else if (Array.isArray(item)) {
      lines.push(`${pad}- []`);
    } else {
      lines.push(`${pad}- ${scalar(item)}`);
    }
  }
  return lines;
}

/** Block YAML with every string double-quoted, so no value is ever reinterpreted. */
export function toYaml(o: Obj): string {
  return emitMap(o, 0).join("\n") + "\n";
}

// ── Impact preview ──────────────────────────────────────────────────────────

export interface PolicyImpact {
  /** "ns/pod (ingress|egress)" for pods this policy newly isolates. */
  isolated: string[];
  /** "src → dst" connections allowed today that this policy would block. */
  blocked: string[];
  /** Connections blocked today that this policy would open. */
  allowed: string[];
  /** Connections still allowed, but only on the listed ports. */
  narrowed: string[];
  /** True when maxPairs was reached, so the lists are partial. */
  truncated: boolean;
}

const keyOf = (p: Obj) => `${str(rec(p.metadata).namespace)}/${str(rec(p.metadata).name)}`;

function typesOf(spec: Obj): string[] {
  const explicit = arr(spec.policyTypes).map(str);
  if (explicit.length > 0) return explicit;
  return spec.egress !== undefined ? ["Ingress", "Egress"] : ["Ingress"];
}

function selects(policy: Obj, pod: Obj): boolean {
  return (
    str(rec(pod.metadata).namespace) === str(rec(policy.metadata).namespace) &&
    matchesSelector(rec(rec(pod.metadata).labels) as Record<string, string>, rec(rec(policy.spec).podSelector))
  );
}

export function policyImpact(input: { policy: Obj; pods: Obj[]; policies: Obj[]; namespaces: Obj[]; maxPairs?: number }): PolicyImpact {
  const maxPairs = input.maxPairs ?? 20_000;
  const ns = str(rec(input.policy.metadata).namespace);
  // Applying a policy whose name already exists in the namespace replaces it.
  const name = str(rec(input.policy.metadata).name);
  const sameName = (p: Obj) => str(rec(p.metadata).namespace) === ns && str(rec(p.metadata).name) === name;
  const replaced = input.policies.filter(sameName);
  const after = [...input.policies.filter((p) => !sameName(p)), input.policy];
  const out: PolicyImpact = { isolated: [], blocked: [], allowed: [], narrowed: [], truncated: false };

  const alreadyIsolated = (pod: Obj, dir: string) => input.policies.some((p) => typesOf(rec(p.spec)).includes(dir) && selects(p, pod));

  const seen = new Set<string>();
  const compare = (src: Obj, dst: Obj, side: "ingress" | "egress") => {
    const pair = `${keyOf(src)} → ${keyOf(dst)}`;
    if (seen.has(pair)) return;
    if (seen.size >= maxPairs) {
      out.truncated = true;
      return;
    }
    seen.add(pair);
    const before = evaluateConnection({ src, dst, policies: input.policies, namespaces: input.namespaces });
    const now = evaluateConnection({ src, dst, policies: after, namespaces: input.namespaces });
    if (before.allowed && !now.allowed) out.blocked.push(pair);
    else if (!before.allowed && now.allowed) out.allowed.push(pair);
    else if (before.allowed && now.allowed) {
      const ports = now[side].allowedPorts;
      if (ports && ports.join() !== (before[side].allowedPorts ?? []).join()) out.narrowed.push(`${pair} (${ports.join(", ")} only)`);
    }
  };

  // Only pods the new policy (or the one it replaces) selects can change.
  for (const pol of [input.policy, ...replaced]) {
    const types = typesOf(rec(pol.spec));
    for (const s of input.pods.filter((p) => selects(pol, p))) {
      for (const [dir, side] of [["Ingress", "ingress"], ["Egress", "egress"]] as const) {
        if (!types.includes(dir)) continue;
        if (pol === input.policy && !alreadyIsolated(s, dir)) out.isolated.push(`${keyOf(s)} (${side})`);
        for (const p of input.pods) {
          if (p === s) continue;
          if (side === "ingress") compare(p, s, side);
          else compare(s, p, side);
        }
      }
    }
  }
  for (const k of ["isolated", "blocked", "allowed", "narrowed"] as const) out[k].sort();
  return out;
}
