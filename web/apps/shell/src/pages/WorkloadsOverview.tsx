import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, Skeleton, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import type { KObj } from "../lib/topology";
import { fmtBytes, fmtCpu } from "./Workloads";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

interface KindSummary {
  label: string;
  to: string;
  total: number;
  healthy: number;
  unhealthy: number;
}

function useKindCounts(cluster: string | undefined) {
  const pods = useResourceStream(cluster, "v1/pods", { mode: "full" });
  const deps = useResourceStream(cluster, "apps/v1/deployments", { mode: "full" });
  const stss = useResourceStream(cluster, "apps/v1/statefulsets", { mode: "full" });
  const dss = useResourceStream(cluster, "apps/v1/daemonsets", { mode: "full" });
  const jobs = useResourceStream(cluster, "batch/v1/jobs", { mode: "full" });
  const nodes = useResourceStream(cluster, "v1/nodes", { mode: "metadata" });

  return useMemo(() => {
    const out: KindSummary[] = [];

    let podOk = 0;
    let podBad = 0;
    for (const raw of pods.rows) {
      const o = raw as KObj;
      const status = rec(o.status);
      const phase = (status.phase as string) ?? "";
      if (phase === "Running" || phase === "Succeeded") podOk++;
      else podBad++;
    }
    out.push({ label: "Pods", to: "/workloads", total: pods.rows.length, healthy: podOk, unhealthy: podBad });

    function wlHealth(rows: Record<string, unknown>[]): { ok: number; bad: number } {
      let ok = 0, bad = 0;
      for (const raw of rows) {
        const o = raw as KObj;
        const status = rec(o.status);
        const spec = rec(o.spec);
        const desired = Number((spec.replicas as number) ?? 1);
        const ready = Number((status.readyReplicas as number) ?? 0);
        if (ready >= desired && desired > 0) ok++;
        else bad++;
      }
      return { ok, bad };
    }

    const depH = wlHealth(deps.rows);
    out.push({ label: "Deployments", to: "/r/deployments", total: deps.rows.length, healthy: depH.ok, unhealthy: depH.bad });
    const stsH = wlHealth(stss.rows);
    out.push({ label: "StatefulSets", to: "/r/statefulsets", total: stss.rows.length, healthy: stsH.ok, unhealthy: stsH.bad });
    const dsH = wlHealth(dss.rows);
    out.push({ label: "DaemonSets", to: "/r/daemonsets", total: dss.rows.length, healthy: dsH.ok, unhealthy: dsH.bad });

    let jobOk = 0, jobBad = 0;
    for (const raw of jobs.rows) {
      const o = raw as KObj;
      const failed = Number((rec(o.status).failed as number) ?? 0);
      if (failed > 0) jobBad++;
      else jobOk++;
    }
    out.push({ label: "Jobs", to: "/r/jobs", total: jobs.rows.length, healthy: jobOk, unhealthy: jobBad });

    let nodeReady = 0;
    for (const raw of nodes.rows) {
      const o = raw as KObj;
      const conds = (rec(o.status).conditions ?? []) as Record<string, unknown>[];
      const ready = conds.find((c) => c.type === "Ready");
      if (ready?.status === "True") nodeReady++;
    }
    out.push({ label: "Nodes", to: "/r/nodes", total: nodes.rows.length, healthy: nodeReady, unhealthy: nodes.rows.length - nodeReady });

    return {
      kinds: out,
      synced: pods.synced && deps.synced && stss.synced && dss.synced && jobs.synced && nodes.synced,
    };
  }, [pods, deps, stss, dss, jobs, nodes]);
}

export default function WorkloadsOverview() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];
  const effectiveCluster = list.find((c) => c.status === "connected")?.id || list[0]?.id || "";

  const { kinds, synced } = useKindCounts(effectiveCluster || undefined);

  const metrics = useQuery({
    queryKey: ["nodemetrics", effectiveCluster],
    queryFn: () => api.podMetrics(effectiveCluster),
    refetchInterval: 15_000,
    enabled: !!effectiveCluster,
    retry: false,
  });

  const totals = useMemo(() => {
    let total = 0, healthy = 0, unhealthy = 0;
    for (const k of kinds) {
      total += k.total;
      healthy += k.healthy;
      unhealthy += k.unhealthy;
    }
    return { total, healthy, unhealthy };
  }, [kinds]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          Workloads Overview
          {synced && <span className="live-pill">● live</span>}
        </h2>
        <Badge>{totals.total} objects</Badge>
      </div>

      <div className="toolbar">
        <select className="toolbar-select" value={effectiveCluster} onChange={() => undefined} aria-label="cluster">
          {list.map((c) => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
      </div>

      {!synced ? (
        <div className="cluster-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <Skeleton w={100} h={14} />
              <div style={{ marginTop: 10 }}>
                <Skeleton w={160} h={10} />
              </div>
              <div style={{ marginTop: 6 }}>
                <Skeleton w={80} h={10} />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="cluster-grid">
          {kinds.map((k) => (
            <Card key={k.label} interactive className="fleet-card">
              <a href={`#${k.to}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <strong>{k.label}</strong>
                  <Badge>{k.total}</Badge>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {k.healthy > 0 && <Badge tone="ok">{k.healthy} ok</Badge>}
                    {k.unhealthy > 0 && <Badge tone="err">{k.unhealthy} issues</Badge>}
                  </span>
                </div>
                {k.total > 0 && (
                  <div style={{ display: "flex", gap: 0, height: 6, borderRadius: 3, overflow: "hidden", background: "var(--kb-bg-inset)" }}>
                    <div style={{
                      width: `${k.healthy > 0 ? (k.healthy / k.total) * 100 : 0}%`,
                      background: "var(--kb-status-ok)",
                      transition: "width 300ms",
                    }} />
                    <div style={{
                      width: `${k.unhealthy > 0 ? (k.unhealthy / k.total) * 100 : 0}%`,
                      background: "var(--kb-status-err)",
                      transition: "width 300ms",
                    }} />
                  </div>
                )}
                {k.total === 0 && <div className="muted small" style={{ marginTop: 4 }}>None</div>}
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
