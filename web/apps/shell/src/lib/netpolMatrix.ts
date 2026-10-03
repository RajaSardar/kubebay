import { evaluateConnection } from "./netpolEval";

type Obj = Record<string, unknown>;

export interface MatrixCell {
  /** open: no policy isolates either pod. allowed: isolated, but a rule lets it through. blocked: nothing does. */
  status: "open" | "allowed" | "blocked";
  /** Policies that allow the traffic, egress side first. */
  policies: string[];
  /** Set when every allowing rule is port-restricted. */
  allowedPorts?: string[];
  /** For a blocked cell: the isolating policies on each side that blocks, as "egress: ns/name". */
  blockedBy?: string[];
}

/**
 * One matrix cell, from representative source and destination pods, using
 * lib/netpolEval's per-pod, per-direction evaluation. It replaces the page's
 * old namespace-level approximation, which ignored egress and ports and
 * treated an Ingress policy without rules as allow-all.
 */
export function matrixCell(src: Obj, dst: Obj, policies: Obj[], namespaces: Obj[]): MatrixCell {
  const v = evaluateConnection({ src, dst, policies, namespaces });
  if (!v.egress.isolated && !v.ingress.isolated) return { status: "open", policies: [] };
  if (!v.allowed) {
    const blockedBy = [
      ...(v.egress.allowed ? [] : v.egress.selectingPolicies.map((p) => `egress: ${p}`)),
      ...(v.ingress.allowed ? [] : v.ingress.selectingPolicies.map((p) => `ingress: ${p}`)),
    ];
    return { status: "blocked", policies: [], blockedBy };
  }
  const cell: MatrixCell = { status: "allowed", policies: [...v.egress.allowingPolicies, ...v.ingress.allowingPolicies] };
  const ports = [...(v.egress.allowedPorts ?? []), ...(v.ingress.allowedPorts ?? [])];
  if (ports.length > 0) cell.allowedPorts = [...new Set(ports)].sort();
  return cell;
}
