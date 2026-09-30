import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery as useRQQuery } from "@tanstack/react-query";
import { Badge, Card, PageHeader, Row, SegmentedControl, Select, Skeleton } from "@kubebay/ui";
import { useCluster } from "../lib/useCluster";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import { WorkloadTabBar } from "../components/WorkloadTabBar";
import { PressureGrid } from "../components/PressureGrid";
import { SpofRadarList } from "../components/SpofRadarList";
import { aggregatePressure } from "../lib/pressure";
import { computeSpofFindings } from "../lib/spof";
import { useLeadingThrottle } from "../lib/useLeadingThrottle";
import { api } from "../lib/api";
import { computeKindCounts } from "../lib/kindCounts";
import { ServiceMismatchList } from "../components/ServiceMismatchList";
import { findServiceSelectorMismatches } from "../lib/serviceSelectorMismatch";

function useKindCounts(
  pods: ReturnType<typeof useResourceStream>,
  nodes: ReturnType<typeof useResourceStream>,
  deps: ReturnType<typeof useResourceStream>,
  stss: ReturnType<typeof useResourceStream>,
  cluster: string | undefined,
) {
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

type OverviewTab = "overview" | "pressure" | "spof" | "service-health";

export default function WorkloadsOverview() {
  const { cluster: effectiveCluster, setCluster, list } = useCluster();
  const [tab, setTab] = useState<OverviewTab>("overview");

  // Lifted here (rather than inside useKindCounts) so the Pressure tab can
  // reuse the same subscriptions instead of opening a second one for the
  // same GVR+mode.
  const pods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full" });
  const nodes = useResourceStream(effectiveCluster || undefined, "v1/nodes", { mode: "full" });
  // Also lifted (not just pods/nodes) so the SPOF Radar tab can reuse these
  // instead of opening a second subscription for the same GVR+mode.
  const deployments = useResourceStream(effectiveCluster || undefined, "apps/v1/deployments", { mode: "full" });
  const statefulSets = useResourceStream(effectiveCluster || undefined, "apps/v1/statefulsets", { mode: "full" });

  const { kinds, synced } = useKindCounts(pods, nodes, deployments, statefulSets, effectiveCluster || undefined);

  // Tab-gated like the Pressure tab's podMetricsQ: an unvisited tab opens no
  // extra subscriptions. Services and EndpointSlices are shared by the SPOF
  // Radar and Service Health tabs -- one subscription each, not two.
  const spofActive = tab === "spof";
  const serviceHealthActive = tab === "service-health";
  const pdbs = useResourceStream(effectiveCluster || undefined, "policy/v1/poddisruptionbudgets", { mode: "full", enabled: spofActive });
  const services = useResourceStream(effectiveCluster || undefined, "v1/services", { mode: "full", enabled: spofActive || serviceHealthActive });
  const endpointSlices = useResourceStream(effectiveCluster || undefined, "discovery.k8s.io/v1/endpointslices", { mode: "full", enabled: spofActive || serviceHealthActive });
  const spofFindings = useMemo(
    () =>
      computeSpofFindings({
        deployments: deployments.rows,
        statefulSets: statefulSets.rows,
        pdbs: pdbs.rows,
        pods: pods.rows,
        services: services.rows,
        endpointSlices: endpointSlices.rows,
      }),
    [deployments.rows, statefulSets.rows, pdbs.rows, pods.rows, services.rows, endpointSlices.rows],
  );

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

  const serviceMismatches = useMemo(
    () => findServiceSelectorMismatches(services.rows, pods.rows, endpointSlices.rows),
    [services.rows, pods.rows, endpointSlices.rows],
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
        <SegmentedControl
          label="View"
          className="toolbar-end"
          options={[
            { value: "overview", label: "Overview" },
            { value: "pressure", label: "Pressure" },
            { value: "spof", label: "SPOF Radar" },
            { value: "service-health", label: "Service Health" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="page-body">
      {tab === "pressure" ? (
        <PressureGrid grid={pressureGrid} />
      ) : tab === "spof" ? (
        <SpofRadarList findings={spofFindings} />
      ) : tab === "service-health" ? (
        <ServiceMismatchList findings={serviceMismatches} />
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
                <Row align="center" gap={2} style={{ marginBottom: 10 }}>
                  <strong>{k.label}</strong>
                  <Badge>{k.total}</Badge>
                  <Row gap={2} as="span" style={{ marginLeft: "auto" }}>
                    {k.healthy > 0 && <Badge tone="ok">{k.healthy} ok</Badge>}
                    {k.unhealthy > 0 && <Badge tone="err">{k.unhealthy} issues</Badge>}
                  </Row>
                </Row>
                {k.total > 0 && (
                  <Row gap={0} style={{ height: 6, borderRadius: "var(--kb-radius-xs)", overflow: "hidden", background: "var(--kb-bg-inset)" }}>
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
                  </Row>
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
