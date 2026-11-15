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

export interface NamespaceRequests {
  ns: string;
  cpuMillis: number;
  memBytes: number;
}

export interface UnrequestedContainer {
  ns: string;
  pod: string;
  container: string;
  node: string;
}

export interface NodeWaste {
  name: string;
  allocatableCpuMillis: number;
  allocatableMemBytes: number;
  requestedCpuMillis: number;
  requestedMemBytes: number;
  idleCpuMillis: number;
  idleMemBytes: number;
  systemOverheadCpuMillis: number;
  systemOverheadMemBytes: number;
  byNamespace: NamespaceRequests[];
}

export interface ClusterWaste {
  nodes: NodeWaste[];
  totalIdleCpuMillis: number;
  totalIdleMemBytes: number;
  totalSystemOverheadCpuMillis: number;
  totalSystemOverheadMemBytes: number;
  byNamespace: NamespaceRequests[];
  unrequestedContainers: UnrequestedContainer[];
}

function isDaemonSetOwned(pod: Record<string, unknown>): boolean {
  const refs = arr(rec(pod.metadata).ownerReferences);
  return refs.some((r) => str(rec(r).kind) === "DaemonSet");
}

function addTo(map: Map<string, { cpuMillis: number; memBytes: number }>, key: string, cpu: number, mem: number) {
  const cur = map.get(key) ?? { cpuMillis: 0, memBytes: 0 };
  map.set(key, { cpuMillis: cur.cpuMillis + cpu, memBytes: cur.memBytes + mem });
}

/**
 * Tier 0 waste accounting (innovation backlog #6, Phase 0): allocatable minus
 * the sum of scheduled pod requests, computed purely from already-streamed
 * `v1/nodes` (mode:"full" — allocatable is stripped otherwise) and `v1/pods`.
 * No metrics required, so it's exact and never stale, but it can only ever
 * see requests vs capacity — not actual usage.
 *
 * Node idle is deliberately kept as its own top-level line and never spread
 * across namespaces: attributing unclaimed capacity to a team makes their
 * number depend on unrelated teams' scheduling and collapses trust the first
 * time someone checks the math. DaemonSet pods go to a system-overhead
 * bucket instead of whatever namespace they happen to live in (usually
 * kube-system), since they're cluster infrastructure, not a team's workload.
 */
export function computeClusterWaste(nodes: Record<string, unknown>[], pods: Record<string, unknown>[]): ClusterWaste {
  const podsByNode = new Map<string, Record<string, unknown>[]>();
  for (const p of pods) {
    const nodeName = str(rec(p.spec).nodeName);
    if (!nodeName) continue; // unscheduled — no capacity to attribute against
    podsByNode.set(nodeName, [...(podsByNode.get(nodeName) ?? []), p]);
  }

  const unrequestedContainers: UnrequestedContainer[] = [];
  const clusterByNamespace = new Map<string, { cpuMillis: number; memBytes: number }>();
  let totalSystemOverheadCpuMillis = 0;
  let totalSystemOverheadMemBytes = 0;

  const nodeWaste: NodeWaste[] = nodes.map((node) => {
    const name = str(rec(node.metadata).name);
    const allocatable = rec(rec(node.status).allocatable);
    const allocatableCpuMillis = parseCpuMillis(str(allocatable.cpu));
    const allocatableMemBytes = parseMemBytes(str(allocatable.memory));

    let requestedCpuMillis = 0;
    let requestedMemBytes = 0;
    let systemOverheadCpuMillis = 0;
    let systemOverheadMemBytes = 0;
    const nsRequests = new Map<string, { cpuMillis: number; memBytes: number }>();

    for (const pod of podsByNode.get(name) ?? []) {
      const ns = str(rec(pod.metadata).namespace);
      const podName = str(rec(pod.metadata).name);
      const daemonSet = isDaemonSetOwned(pod);
      const containers = arr(rec(pod.spec).containers);

      for (const c of containers) {
        const cc = rec(c);
        const requests = rec(rec(cc.resources).requests);
        const cpuStr = str(requests.cpu);
        const memStr = str(requests.memory);
        if (!cpuStr && !memStr) {
          unrequestedContainers.push({ ns, pod: podName, container: str(cc.name), node: name });
        }
        const cpu = parseCpuMillis(cpuStr);
        const mem = parseMemBytes(memStr);

        requestedCpuMillis += cpu;
        requestedMemBytes += mem;

        if (daemonSet) {
          systemOverheadCpuMillis += cpu;
          systemOverheadMemBytes += mem;
        } else {
          addTo(nsRequests, ns, cpu, mem);
          addTo(clusterByNamespace, ns, cpu, mem);
        }
      }
    }

    totalSystemOverheadCpuMillis += systemOverheadCpuMillis;
    totalSystemOverheadMemBytes += systemOverheadMemBytes;

    return {
      name,
      allocatableCpuMillis,
      allocatableMemBytes,
      requestedCpuMillis,
      requestedMemBytes,
      idleCpuMillis: Math.max(allocatableCpuMillis - requestedCpuMillis, 0),
      idleMemBytes: Math.max(allocatableMemBytes - requestedMemBytes, 0),
      systemOverheadCpuMillis,
      systemOverheadMemBytes,
      byNamespace: [...nsRequests.entries()].map(([ns, v]) => ({ ns, ...v })),
    };
  });

  return {
    nodes: nodeWaste,
    totalIdleCpuMillis: nodeWaste.reduce((s, n) => s + n.idleCpuMillis, 0),
    totalIdleMemBytes: nodeWaste.reduce((s, n) => s + n.idleMemBytes, 0),
    totalSystemOverheadCpuMillis,
    totalSystemOverheadMemBytes,
    byNamespace: [...clusterByNamespace.entries()].map(([ns, v]) => ({ ns, ...v })),
    unrequestedContainers,
  };
}
