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
function count(v: unknown): number {
  const n = Number(str(v) || v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Vendor device-plugin GPU resources (nvidia.com/gpu, amd.com/gpu, gpu.intel.com/*) and NVIDIA MIG slices. */
export function isGpuResource(name: string): boolean {
  if (!name.includes("/")) return false;
  const [domain = "", res = ""] = name.split("/");
  return res === "gpu" || domain.startsWith("gpu.") || res.startsWith("mig-");
}

function gpuAsks(containers: unknown[], combine: (a: number, b: number) => number): Map<string, number> {
  const asks = new Map<string, number>();
  for (const c of containers) {
    const res = rec(rec(c).resources);
    const requests = rec(res.requests);
    const limits = rec(res.limits);
    for (const resource of new Set([...Object.keys(requests), ...Object.keys(limits)])) {
      if (!isGpuResource(resource)) continue;
      const n = count(requests[resource] ?? limits[resource]);
      if (n > 0) asks.set(resource, combine(asks.get(resource) ?? 0, n));
    }
  }
  return asks;
}

export interface GpuNodeRow {
  node: string;
  resource: string;
  allocatable: number;
  requested: number;
}

export interface GpuTotal {
  resource: string;
  allocatable: number;
  requested: number;
  idle: number;
}

export interface GpuPod {
  namespace: string;
  pod: string;
  node: string;
  resource: string;
  count: number;
}

export interface GpuCapacity {
  nodes: GpuNodeRow[];
  totals: GpuTotal[];
  pods: GpuPod[];
  /** Pods not yet on a node that ask for a GPU: queued work, or asks no node can meet. */
  pending: GpuPod[];
}

/**
 * Roadmap Tier 2 #14, Phase 0: GPU capacity accounting from objects already
 * streamed, the GPU twin of lib/waste.ts. Allocatable GPUs per node vs the
 * GPUs scheduled pods ask for, so unclaimed GPUs (the most expensive idle
 * capacity in most clusters) show up without any metrics. Extended resources
 * can't be overcommitted and requests default to limits, so a container's
 * GPU count is its request, else its limit. Finished pods hold nothing.
 * Actual utilisation (DCGM via Prometheus) is Phase 1.
 */
export function computeGpuCapacity(nodes: Obj[], pods: Obj[]): GpuCapacity {
  const rows = new Map<string, GpuNodeRow>();
  for (const n of nodes) {
    const name = str(rec(n.metadata).name);
    for (const [resource, v] of Object.entries(rec(rec(n.status).allocatable))) {
      if (!isGpuResource(resource) || count(v) === 0) continue;
      rows.set(`${name}\u0000${resource}`, { node: name, resource, allocatable: count(v), requested: 0 });
    }
  }

  const gpuPods: GpuPod[] = [];
  const pending: GpuPod[] = [];
  for (const p of pods) {
    const phase = str(rec(p.status).phase);
    if (phase === "Succeeded" || phase === "Failed") continue;
    const meta = rec(p.metadata);
    const nodeName = str(rec(p.spec).nodeName);
    // Effective ask per resource = max(largest init container, sum of containers), as the scheduler computes it.
    const sum = gpuAsks(arr(rec(p.spec).containers), (a, b) => a + b);
    const initMax = gpuAsks(arr(rec(p.spec).initContainers), Math.max);
    const asks = new Map(sum);
    for (const [resource, n] of initMax) asks.set(resource, Math.max(asks.get(resource) ?? 0, n));
    for (const [resource, n] of asks) {
      const entry = { namespace: str(meta.namespace), pod: str(meta.name), node: nodeName, resource, count: n };
      if (!nodeName) {
        pending.push(entry);
        continue;
      }
      gpuPods.push(entry);
      const row = rows.get(`${nodeName}\u0000${resource}`);
      if (row) row.requested += n;
    }
  }

  const nodeRows = [...rows.values()].sort((a, b) => a.node.localeCompare(b.node) || a.resource.localeCompare(b.resource));
  const totals = new Map<string, GpuTotal>();
  for (const r of nodeRows) {
    const t = totals.get(r.resource) ?? { resource: r.resource, allocatable: 0, requested: 0, idle: 0 };
    t.allocatable += r.allocatable;
    t.requested += r.requested;
    t.idle = Math.max(t.allocatable - t.requested, 0);
    totals.set(r.resource, t);
  }

  return { nodes: nodeRows, totals: [...totals.values()], pods: gpuPods, pending };
}
