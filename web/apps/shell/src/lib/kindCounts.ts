function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

export interface KindSummary {
  label: string;
  to: string;
  total: number;
  healthy: number;
  unhealthy: number;
}

export interface KindCountsInput {
  pods: Record<string, unknown>[];
  nodes: Record<string, unknown>[];
  deployments: Record<string, unknown>[];
  statefulsets: Record<string, unknown>[];
  daemonsets: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
}

function workloadHealth(rows: Record<string, unknown>[]): { ok: number; bad: number } {
  let ok = 0;
  let bad = 0;
  for (const raw of rows) {
    const status = rec(raw.status);
    const spec = rec(raw.spec);
    const desired = Number((spec.replicas as number) ?? 1);
    const ready = Number((status.readyReplicas as number) ?? 0);
    if (ready >= desired && desired > 0) ok++;
    else bad++;
  }
  return { ok, bad };
}

/**
 * Extracted out of WorkloadsOverview.tsx's useKindCounts (backlog #15) so
 * the per-kind health math is a pure, cluster-parameterized function the
 * Fleet dashboard can fan out across every connected cluster, instead of
 * being locked inside a hook tied to the single active cluster.
 */
export function computeKindCounts(input: KindCountsInput): KindSummary[] {
  const out: KindSummary[] = [];

  let podOk = 0;
  let podBad = 0;
  for (const raw of input.pods) {
    const phase = (rec(raw.status).phase as string) ?? "";
    if (phase === "Running" || phase === "Succeeded") podOk++;
    else podBad++;
  }
  out.push({ label: "Pods", to: "/workloads", total: input.pods.length, healthy: podOk, unhealthy: podBad });

  const depH = workloadHealth(input.deployments);
  out.push({ label: "Deployments", to: "/r/deployments", total: input.deployments.length, healthy: depH.ok, unhealthy: depH.bad });
  const stsH = workloadHealth(input.statefulsets);
  out.push({ label: "StatefulSets", to: "/r/statefulsets", total: input.statefulsets.length, healthy: stsH.ok, unhealthy: stsH.bad });
  const dsH = workloadHealth(input.daemonsets);
  out.push({ label: "DaemonSets", to: "/r/daemonsets", total: input.daemonsets.length, healthy: dsH.ok, unhealthy: dsH.bad });

  let jobOk = 0;
  let jobBad = 0;
  for (const raw of input.jobs) {
    const failed = Number((rec(raw.status).failed as number) ?? 0);
    if (failed > 0) jobBad++;
    else jobOk++;
  }
  out.push({ label: "Jobs", to: "/r/jobs", total: input.jobs.length, healthy: jobOk, unhealthy: jobBad });

  let nodeReady = 0;
  for (const raw of input.nodes) {
    const conds = (rec(raw.status).conditions ?? []) as Record<string, unknown>[];
    const ready = conds.find((c) => c.type === "Ready");
    if (ready?.status === "True") nodeReady++;
  }
  out.push({ label: "Nodes", to: "/r/nodes", total: input.nodes.length, healthy: nodeReady, unhealthy: input.nodes.length - nodeReady });

  return out;
}
