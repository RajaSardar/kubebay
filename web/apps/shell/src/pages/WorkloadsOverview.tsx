import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery as useRQQuery } from "@tanstack/react-query";
import { Badge, Card, PageHeader, Select, Skeleton } from "@kubebay/ui";
import { useCluster } from "../lib/useCluster";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import { WorkloadTabBar } from "../components/WorkloadTabBar";
import { PressureGrid } from "../components/PressureGrid";
import { aggregatePressure } from "../lib/pressure";
import { useLeadingThrottle } from "../lib/useLeadingThrottle";
import { api } from "../lib/api";
import { computeKindCounts } from "../lib/kindCounts";

function useKindCounts(
  cluster: string | undefined,
  pods: ReturnType<typeof useResourceStream>,
  nodes: ReturnType<typeof useResourceStream>,
) {
  const deps = useResourceStream(cluster, "apps/v1/deployments", { mode: "full" });
  const stss = useResourceStream(cluster, "apps/v1/statefulsets", { mode: "full" });
  const dss = useResourceStream(cluster, "apps/v1/daemonsets", { mode: "full" });
  const jobs = useResourceStream(cluster, "batch/v1/jobs", { mode: "full" });

  return useMemo(
    () => ({
      kinds: computeKindCounts({
        pods: pods.rows,
        nodes: nodes.rows,
        deployments: deps.rows,
        statefulsets: stss.rows,
        daemonsets: dss.rows,
        jobs: jobs.rows,
      }),
      synced: pods.synced && deps.synced && stss.synced && dss.synced && jobs.synced && nodes.synced,
    }),
    [pods, deps, stss, dss, jobs, nodes],
  );
}

type OverviewTab = "overview" | "pressure";

export default function WorkloadsOverview() {
  const { cluster: effectiveCluster, setCluster, list } = useCluster();
  const [tab, setTab] = useState<OverviewTab>("overview");

  // Lifted here (rather than inside useKindCounts) so the Pressure tab can
  // reuse the same subscriptions instead of opening a second one for the
  // same GVR+mode.
  const pods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full" });
  const nodes = useResourceStream(effectiveCluster || undefined, "v1/nodes", { mode: "full" });

  const { kinds, synced } = useKindCounts(effectiveCluster || undefined, pods, nodes);

  const totals = useMemo(() => {
    let total = 0, healthy = 0, unhealthy = 0;
    for (const k of kinds) {
      total += k.total;
      healthy += k.healthy;
      unhealthy += k.unhealthy;
    }
    return { total, healthy, unhealthy };
  }, [kinds]);

  const podMetricsQ = useRQQuery({
    queryKey: ["podmetrics", effectiveCluster],
    queryFn: () => api.podMetrics(effectiveCluster),
    enabled: !!effectiveCluster && tab === "pressure",
    refetchInterval: 15_000,
    retry: false,
  });

  // The aggregation is O(pods), so it's throttled to a leading-edge update
  // at most once every 2s rather than recomputing on every stream flush.
  const pressureInputs = useLeadingThrottle(
    useMemo(() => ({ pods: pods.rows, nodes: nodes.rows, usage: podMetricsQ.data ?? [] }), [pods.rows, nodes.rows, podMetricsQ.data]),
    2000,
  );
  const pressureGrid = useMemo(
    () => aggregatePressure(pressureInputs.pods, pressureInputs.nodes, pressureInputs.usage),
    [pressureInputs],
  );

  return (
    <div className="page">
      <WorkloadTabBar />
      <PageHeader level={2} title="Workloads Overview" live={synced} actions={<Badge>{totals.total} objects</Badge>} />

      <div className="toolbar">
        <Select value={effectiveCluster} onChange={(e) => setCluster(e.target.value)} aria-label="cluster">
          {list.map((c) => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </Select>
        <div className="drawer-pane-tabs" style={{ marginLeft: "auto" }}>
          <button className={`tab${tab === "overview" ? " active" : ""}`} onClick={() => setTab("overview")}>Overview</button>
          <button className={`tab${tab === "pressure" ? " active" : ""}`} onClick={() => setTab("pressure")}>Pressure</button>
        </div>
      </div>

      <div className="page-body">
      {tab === "pressure" ? (
        <PressureGrid grid={pressureGrid} />
      ) : shouldShowSkeleton(synced, totals.total) ? (
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
              <Link to={k.to} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <strong>{k.label}</strong>
                  <Badge>{k.total}</Badge>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {k.healthy > 0 && <Badge tone="ok">{k.healthy} ok</Badge>}
                    {k.unhealthy > 0 && <Badge tone="err">{k.unhealthy} issues</Badge>}
                  </span>
                </div>
                {k.total > 0 && (
                  <div style={{ display: "flex", gap: 0, height: 6, borderRadius: "var(--kb-radius-xs)", overflow: "hidden", background: "var(--kb-bg-inset)" }}>
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
              </Link>
            </Card>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
