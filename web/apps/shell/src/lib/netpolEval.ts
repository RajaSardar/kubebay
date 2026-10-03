import { matchesSelector, type LabelSelector } from "./labelSelector";

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
function labelsOf(o: Obj): Record<string, string> {
  return rec(rec(o.metadata).labels) as Record<string, string>;
}

export interface SideVerdict {
  /** Some policy selects the pod for this direction, so only listed traffic gets through. */
  isolated: boolean;
  allowed: boolean;
  selectingPolicies: string[];
  allowingPolicies: string[];
  /** Set when no port was asked about and every allowing rule is port-restricted. */
  allowedPorts?: string[];
}

export interface ConnectionVerdict {
  allowed: boolean;
  egress: SideVerdict;
  ingress: SideVerdict;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const ipN = ipv4ToInt(ip);
  const baseN = ipv4ToInt(base ?? "");
  const bits = Number(bitsStr ?? "32");
  if (ipN === null || baseN === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(ipN / size) === Math.floor(baseN / size);
}

function policyTypes(spec: Obj): string[] {
  const explicit = arr(spec.policyTypes).map(str);
  if (explicit.length > 0) return explicit;
  return spec.egress !== undefined ? ["Ingress", "Egress"] : ["Ingress"];
}

function namedPort(pod: Obj, name: string, protocol: string): number | undefined {
  for (const c of [...arr(rec(pod.spec).containers), ...arr(rec(pod.spec).initContainers)]) {
    for (const p of arr(rec(c).ports).map(rec)) {
      if (str(p.name) === name && (str(p.protocol) || "TCP") === protocol) return typeof p.containerPort === "number" ? p.containerPort : undefined;
    }
  }
  return undefined;
}

function portLabel(p: Obj): string {
  const protocol = str(p.protocol) || "TCP";
  if (p.port === undefined) return `${protocol}/*`;
  return typeof p.endPort === "number" ? `${protocol}/${String(p.port)}-${p.endPort}` : `${protocol}/${String(p.port)}`;
}

/**
 * Roadmap Tier 2 #12: "can pod A reach pod B (on this port)?" under standard
 * Kubernetes NetworkPolicy semantics. Isolation is per pod and per
 * direction: a pod is isolated for ingress (or egress) once any policy in
 * its namespace selects it with that policy type, and then only traffic some
 * selecting policy's rule allows gets through. Both the source's egress and
 * the destination's ingress must allow the connection.
 *
 * What the API can't tell us: the CNI actually enforcing policy (a cluster
 * without an enforcing CNI allows everything), CNI-specific CRDs
 * (CiliumNetworkPolicy, Calico GlobalNetworkPolicy), and how a CNI treats
 * ipBlock for pod IPs. Callers should say so.
 */
export function evaluateConnection(input: {
  src: Obj;
  dst: Obj;
  port?: { port: number; protocol?: string };
  policies: Obj[];
  namespaces: Obj[];
}): ConnectionVerdict {
  const nsLabels = new Map<string, Record<string, string>>();
  for (const n of input.namespaces) {
    const name = str(rec(n.metadata).name);
    nsLabels.set(name, { ...labelsOf(n), "kubernetes.io/metadata.name": name });
  }
  const labelsOfNs = (name: string) => nsLabels.get(name) ?? { "kubernetes.io/metadata.name": name };
  const nsOf = (o: Obj) => str(rec(o.metadata).namespace);
  const protocol = input.port?.protocol ?? "TCP";

  const side = (direction: "Ingress" | "Egress"): SideVerdict => {
    const self = direction === "Ingress" ? input.dst : input.src;
    const peer = direction === "Ingress" ? input.src : input.dst;
    const selfNs = nsOf(self);

    const selecting = input.policies.filter((p) => {
      const spec = rec(p.spec);
      return nsOf(p) === selfNs && policyTypes(spec).includes(direction) && matchesSelector(labelsOf(self), rec(spec.podSelector) as LabelSelector);
    });

    const peerMatches = (peerSpec: Obj, policyNs: string): boolean => {
      if (peerSpec.ipBlock) {
        const block = rec(peerSpec.ipBlock);
        const ip = str(rec(peer.status).podIP);
        return !!ip && inCidr(ip, str(block.cidr)) && !arr(block.except).map(str).some((c) => inCidr(ip, c));
      }
      const hasNs = peerSpec.namespaceSelector !== undefined;
      const hasPod = peerSpec.podSelector !== undefined;
      if (hasNs && !matchesSelector(labelsOfNs(nsOf(peer)), rec(peerSpec.namespaceSelector) as LabelSelector)) return false;
      if (!hasNs && nsOf(peer) !== policyNs) return false;
      return !hasPod || matchesSelector(labelsOf(peer), rec(peerSpec.podSelector) as LabelSelector);
    };

    // The destination pod's named ports resolve named rule ports in both directions.
    const portMatches = (p: Obj): boolean => {
      if (!input.port) return true;
      if ((str(p.protocol) || "TCP") !== protocol) return false;
      if (p.port === undefined) return true;
      const start = typeof p.port === "number" ? p.port : namedPort(input.dst, str(p.port), protocol);
      if (start === undefined) return false;
      const end = typeof p.endPort === "number" ? p.endPort : start;
      return input.port.port >= start && input.port.port <= end;
    };

    const allowing: string[] = [];
    const ports = new Set<string>();
    let anyUnrestricted = false;
    for (const p of selecting) {
      const spec = rec(p.spec);
      const rules = arr(direction === "Ingress" ? spec.ingress : spec.egress).map(rec);
      let allows = false;
      for (const rule of rules) {
        const peers = arr(direction === "Ingress" ? rule.from : rule.to).map(rec);
        if (peers.length > 0 && !peers.some((pe) => peerMatches(pe, nsOf(p)))) continue;
        const rulePorts = arr(rule.ports).map(rec);
        if (rulePorts.length > 0 && !rulePorts.some(portMatches)) continue;
        allows = true;
        if (rulePorts.length === 0) anyUnrestricted = true;
        else rulePorts.forEach((rp) => ports.add(portLabel(rp)));
      }
      if (allows) allowing.push(`${nsOf(p)}/${str(rec(p.metadata).name)}`);
    }

    const isolated = selecting.length > 0;
    const verdict: SideVerdict = {
      isolated,
      allowed: !isolated || allowing.length > 0,
      selectingPolicies: selecting.map((p) => `${nsOf(p)}/${str(rec(p.metadata).name)}`),
      allowingPolicies: allowing,
    };
    if (!input.port && isolated && allowing.length > 0 && !anyUnrestricted) verdict.allowedPorts = [...ports].sort();
    return verdict;
  };

  const egress = side("Egress");
  const ingress = side("Ingress");
  return { allowed: egress.allowed && ingress.allowed, egress, ingress };
}
