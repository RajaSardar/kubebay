import type { PodUsage } from "./api";
import { parseCpuMillis, parseMemBytes } from "./rightsizing";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface PressureCell {
  ns: string;
  node: string;
  requestedCpuMillis: number;
  requestedMemBytes: number;
  usedCpuMillis: number;
  usedMemBytes: number;
  bestEffortCount: number;
  podCount: number;
}

export interface PressureGrid {
  namespaces: string[];
  nodes: string[];
  cells: PressureCell[];
  nodeAllocatable: Record<string, { cpuMillis: number; memBytes: number }>;
  hasUsageData: boolean;
  otherNamespacesCount: number;
  otherNodesCount: number;
  otherNamespacesLabel: string;
  otherNodesLabel: string;
}

const DEFAULT_TOP_N = 25;

function scoreOf(v: { cpuMillis: number; memBytes: number }): number {
  return v.cpuMillis / 1000 + v.memBytes / 1024 ** 3;
}

/**
 * Namespace x node resource-pressure aggregation (innovation backlog #1).
 * Every input is already streamed (`v1/pods` + `v1/nodes` in full mode) so
 * requests-vs-allocatable needs zero new backend and no Prometheus; actual
 * usage layers on top only when a metrics-server sample is available —
 * `hasUsageData: false` tells the caller to degrade to a requests-only
 * view with a banner rather than rendering a blank grid.
 *
 * A cluster can have far more namespaces/nodes than are worth drawing as
 * cells (300 nodes x 200 ns would be 60k rects), so both axes are capped at
 * `topN` by consumption and everything past the cutoff is summed into one
 * "+N others" bucket per axis rather than silently dropped.
 */
export function aggregatePressure(
  pods: Record<string, unknown>[],
  nodes: Record<string, unknown>[],
  usage: PodUsage[],
  opts: { topNamespaces?: number; topNodes?: number } = {},
): PressureGrid {
  const topNamespaces = opts.topNamespaces ?? DEFAULT_TOP_N;
  const topNodes = opts.topNodes ?? DEFAULT_TOP_N;

  const nodeAllocatable: Record<string, { cpuMillis: number; memBytes: number }> = {};
  for (const n of nodes) {
    const name = str(rec(n.metadata).name);
    const allocatable = rec(rec(n.status).allocatable);
    nodeAllocatable[name] = {
      cpuMillis: parseCpuMillis(str(allocatable.cpu)),
      memBytes: parseMemBytes(str(allocatable.memory)),
    };
  }

  const usageByPod = new Map<string, PodUsage>();
  for (const u of usage) usageByPod.set(`${u.namespace}/${u.name}`, u);
  const hasUsageData = usage.length > 0;

  const cellMap = new Map<string, PressureCell>();
  const nsScore = new Map<string, number>();
  const nodeScore = new Map<string, number>();

  for (const pod of pods) {
    const meta = rec(pod.metadata);
    const ns = str(meta.namespace);
    const node = str(rec(pod.spec).nodeName);
    if (!node) continue; // unscheduled — nothing to place on the grid

    const containers = arr(rec(pod.spec).containers);
    let cpu = 0;
    let mem = 0;
    for (const c of containers) {
      const requests = rec(rec(rec(c).resources).requests);
      cpu += parseCpuMillis(str(requests.cpu));
      mem += parseMemBytes(str(requests.memory));
    }
    const bestEffort = cpu === 0 && mem === 0;

    const podUsage = usageByPod.get(`${ns}/${str(meta.name)}`);

    const key = `${ns}|${node}`;
    const cell = cellMap.get(key) ?? {
      ns,
      node,
      requestedCpuMillis: 0,
      requestedMemBytes: 0,
      usedCpuMillis: 0,
      usedMemBytes: 0,
      bestEffortCount: 0,
      podCount: 0,
    };
    cell.requestedCpuMillis += cpu;
    cell.requestedMemBytes += mem;
    cell.usedCpuMillis += podUsage?.cpuMillis ?? 0;
    cell.usedMemBytes += podUsage?.memBytes ?? 0;
    cell.bestEffortCount += bestEffort ? 1 : 0;
    cell.podCount += 1;
    cellMap.set(key, cell);

    nsScore.set(ns, (nsScore.get(ns) ?? 0) + scoreOf({ cpuMillis: cpu, memBytes: mem }));
    nodeScore.set(node, (nodeScore.get(node) ?? 0) + scoreOf({ cpuMillis: cpu, memBytes: mem }));
  }

  const rankedNamespaces = [...nsScore.entries()].sort((a, b) => b[1] - a[1]).map(([ns]) => ns);
  const rankedNodes = [...nodeScore.entries()].sort((a, b) => b[1] - a[1]).map(([node]) => node);

  const keptNamespaces = new Set(rankedNamespaces.slice(0, topNamespaces));
  const keptNodes = new Set(rankedNodes.slice(0, topNodes));
  const otherNamespacesCount = Math.max(rankedNamespaces.length - topNamespaces, 0);
  const otherNodesCount = Math.max(rankedNodes.length - topNodes, 0);
  const otherNamespacesLabel = `+${otherNamespacesCount} others`;
  const otherNodesLabel = `+${otherNodesCount} others`;

  const finalCells = new Map<string, PressureCell>();
  for (const cell of cellMap.values()) {
    const ns = keptNamespaces.has(cell.ns) ? cell.ns : otherNamespacesLabel;
    const node = keptNodes.has(cell.node) ? cell.node : otherNodesLabel;
    const key = `${ns}|${node}`;
    const merged = finalCells.get(key) ?? {
      ns,
      node,
      requestedCpuMillis: 0,
      requestedMemBytes: 0,
      usedCpuMillis: 0,
      usedMemBytes: 0,
      bestEffortCount: 0,
      podCount: 0,
    };
    merged.requestedCpuMillis += cell.requestedCpuMillis;
    merged.requestedMemBytes += cell.requestedMemBytes;
    merged.usedCpuMillis += cell.usedCpuMillis;
    merged.usedMemBytes += cell.usedMemBytes;
    merged.bestEffortCount += cell.bestEffortCount;
    merged.podCount += cell.podCount;
    finalCells.set(key, merged);
  }

  return {
    namespaces: [...keptNamespaces],
    nodes: [...keptNodes],
    cells: [...finalCells.values()],
    nodeAllocatable,
    hasUsageData,
    otherNamespacesCount,
    otherNodesCount,
    otherNamespacesLabel,
    otherNodesLabel,
  };
}
