import { parseCpuMillis, parseMemBytes } from "./rightsizing";
import type { PodUsage } from "./api";

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return (v ?? {}) as Obj;
}
function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}

/** Past this share of allocatable requested, the Overview warns (docs/OVERVIEW_V2.md). */
export const CAPACITY_WARN_PCT = 85;

export interface CapacityResource {
  /** Millicores or bytes the running pods ask for. */
  requested: number;
  /** What the schedulable nodes offer. */
  allocatable: number;
  /** What the pods use now; only with metrics-server. */
  used?: number;
  /** Requested as a whole percentage of allocatable. */
  pct: number;
  over: boolean;
}

export interface ClusterCapacity {
  cpu: CapacityResource;
  memory: CapacityResource;
}

/** Pods that hold a node's room: scheduled, not finished, not going away. */
export function holdsRoom(pod: Obj): boolean {
  const phase = rec(pod.status).phase;
  return !rec(pod.metadata).deletionTimestamp && !!rec(pod.spec).nodeName && phase !== "Succeeded" && phase !== "Failed";
}

/** A pod's requests summed over its containers; a container without one asks for nothing. */
export function podRequests(pod: Obj): { cpu: number; memory: number } {
  let cpu = 0;
  let memory = 0;
  for (const c of arr(rec(pod.spec).containers)) {
    const req = rec(rec(c.resources).requests);
    if (req.cpu !== undefined) cpu += parseCpuMillis(String(req.cpu));
    if (req.memory !== undefined) memory += parseMemBytes(String(req.memory));
  }
  return { cpu, memory };
}

function resource(requested: number, allocatable: number, used: number | undefined): CapacityResource {
  const pct = allocatable > 0 ? Math.round((requested / allocatable) * 100) : 0;
  return { requested, allocatable, used, pct, over: pct >= CAPACITY_WARN_PCT };
}

/**
 * Requested of allocatable for CPU and memory across the cluster. Requests
 * come from pod specs and room from node status, so this works on any
 * cluster; `used` is added only when pod metrics exist. Null with no nodes.
 */
export function clusterCapacity(input: { pods: Obj[]; nodes: Obj[]; usage?: PodUsage[] }): ClusterCapacity | null {
  let cpuAlloc = 0;
  let memAlloc = 0;
  for (const n of input.nodes) {
    if (rec(n.spec).unschedulable) continue;
    const a = rec(rec(n.status).allocatable);
    cpuAlloc += parseCpuMillis(String(a.cpu ?? ""));
    memAlloc += parseMemBytes(String(a.memory ?? ""));
  }
  if (cpuAlloc <= 0 && memAlloc <= 0) return null;

  let cpuReq = 0;
  let memReq = 0;
  for (const p of input.pods) {
    if (!holdsRoom(p)) continue;
    const r = podRequests(p);
    cpuReq += r.cpu;
    memReq += r.memory;
  }

  const usage = input.usage && input.usage.length > 0 ? input.usage : undefined;
  const cpuUsed = usage?.reduce((n, u) => n + u.cpuMillis, 0);
  const memUsed = usage?.reduce((n, u) => n + u.memBytes, 0);
  return { cpu: resource(cpuReq, cpuAlloc, cpuUsed), memory: resource(memReq, memAlloc, memUsed) };
}
