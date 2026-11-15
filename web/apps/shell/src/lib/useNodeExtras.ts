import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { metricsApi } from "./api";
import { useResourceStream } from "./useResourceStream";

export interface NodeUsage {
  cpuMillis: number;
  memBytes: number;
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

/** How many pods each node runs; unscheduled pods are left out. */
export function podsPerNode(pods: readonly unknown[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pods) {
    const node = rec(rec(p).spec).nodeName;
    if (typeof node === "string" && node) m.set(node, (m.get(node) ?? 0) + 1);
  }
  return m;
}

/** Node metrics keyed by node name. */
export function usageByName<U extends { name: string } & NodeUsage>(list: readonly U[] | undefined): Map<string, U> {
  const m = new Map<string, U>();
  for (const u of list ?? []) m.set(u.name, u);
  return m;
}

/**
 * What the Nodes table shows beyond the Node objects: live CPU/memory and the
 * pods on each node. Queries nothing unless `enabled` (the table is Nodes).
 */
export function useNodeExtras(cluster: string, enabled: boolean) {
  const usageQ = useQuery({
    queryKey: ["nodemetrics", cluster],
    queryFn: () => metricsApi.nodes(cluster),
    enabled: !!cluster && enabled,
    refetchInterval: 15_000,
    retry: false,
  });
  const nodeUsage = useMemo(() => usageByName(usageQ.data), [usageQ.data]);
  const pods = useResourceStream(cluster || undefined, "v1/pods", { mode: "full", enabled });
  const perNode = useMemo(() => podsPerNode(pods.rows), [pods.rows]);
  return { nodeUsage, podsPerNode: perNode };
}
