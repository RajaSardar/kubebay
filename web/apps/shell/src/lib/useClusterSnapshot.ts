import { useMemo } from "react";
import { useResourceStream } from "./useResourceStream";
import type { KObj } from "./topology";

export interface PodIssue {
  key: string;
  namespace: string;
  pod: string;
  label: string;
  severity: "err" | "warn";
}

export interface ClusterSnapshot {
  synced: boolean;
  nodeTotal: number;
  nodeReady: number;
  podCount: number;
  issues: PodIssue[];
  warnings: number;
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function deriveIssue(o: KObj): PodIssue | null {
  const meta = rec(o.metadata);
  const name = meta.name as string | undefined;
  if (!name) return null;
  const namespace = (meta.namespace as string) ?? "default";

  const status = rec(o.status);
  const spec = rec(o.spec);
  const phase = (status.phase as string) ?? "";
  if (phase === "Succeeded") return null;

  const cs = (status.containerStatuses ?? []) as Record<string, unknown>[];
  for (const c of cs) {
    const waiting = rec(rec(c.state).waiting);
    const reason = (waiting.reason as string) ?? "";
    if (reason && reason !== "ContainerCreating") {
      return { key: `${namespace}/${name}`, namespace, pod: name, label: reason, severity: "err" };
    }
  }
  if (meta.deletionTimestamp) {
    return { key: `${namespace}/${name}`, namespace, pod: name, label: "Terminating", severity: "warn" };
  }
  const containers = (spec.containers ?? []) as unknown[];
  const readyN = cs.filter((c) => c.ready === true).length;
  if (phase === "Running" && containers.length > 0 && readyN < containers.length) {
    return { key: `${namespace}/${name}`, namespace, pod: name, label: `${readyN}/${containers.length} ready`, severity: "warn" };
  }
  if (phase === "Failed") {
    return { key: `${namespace}/${name}`, namespace, pod: name, label: phase, severity: "err" };
  }
  if (phase === "Pending") {
    return { key: `${namespace}/${name}`, namespace, pod: name, label: "Pending", severity: "warn" };
  }
  return null;
}

export function useClusterSnapshot(cluster: string | undefined): ClusterSnapshot {
  const nodes = useResourceStream(cluster, "v1/nodes", { mode: "metadata" });
  const pods = useResourceStream(cluster, "v1/pods", { mode: "full" });
  const events = useResourceStream(cluster, "v1/events", { mode: "full" });

  return useMemo(() => {
    let nodeReady = 0;
    for (const raw of nodes.rows) {
      const o = raw as KObj;
      const conds = (rec(o.status).conditions ?? []) as Record<string, unknown>[];
      const ready = conds.find((c) => c.type === "Ready");
      if (ready?.status === "True") nodeReady += 1;
    }

    const issues: PodIssue[] = [];
    for (const raw of pods.rows) {
      const issue = deriveIssue(raw as KObj);
      if (issue) issues.push(issue);
    }
    issues.sort((a, b) => (a.severity === b.severity ? a.key.localeCompare(b.key) : a.severity === "err" ? -1 : 1));

    let warnings = 0;
    for (const raw of events.rows) {
      if ((raw as Record<string, unknown>).type === "Warning") warnings += 1;
    }

    return {
      synced: nodes.synced && pods.synced && events.synced,
      nodeTotal: nodes.rows.length,
      nodeReady,
      podCount: pods.rows.length,
      issues: issues.slice(0, 5),
      warnings,
    };
  }, [nodes.rows, nodes.synced, pods.rows, pods.synced, events.rows, events.synced]);
}
