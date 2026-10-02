import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery as useRQQuery } from "@tanstack/react-query";
import { Badge, Card, PageHeader, Row, SegmentedControl, Select, Skeleton, Stack } from "@kubebay/ui";
import { useCluster } from "../lib/useCluster";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import { WorkloadTabBar } from "../components/WorkloadTabBar";
import { PressureGrid } from "../components/PressureGrid";
import { SpofRadarList } from "../components/SpofRadarList";
import { aggregatePressure } from "../lib/pressure";
import { computeSpofFindings } from "../lib/spof";
import { useLeadingThrottle } from "../lib/useLeadingThrottle";
import { api, crdApi } from "../lib/api";
import { computeKindCounts } from "../lib/kindCounts";
import { ServiceMismatchList } from "../components/ServiceMismatchList";
import { findServiceSelectorMismatches } from "../lib/serviceSelectorMismatch";
import { CoreDnsHealthCard } from "../components/CoreDnsHealthCard";
import { checkCoreDns } from "../lib/coreDnsHealth";
import { RouteResolutionList } from "../components/RouteResolutionList";
import { NeedsAttention } from "../components/NeedsAttention";
import { findAttention } from "../lib/attention";
import { CapacityLine } from "../components/CapacityLine";
import { clusterCapacity } from "../lib/capacity";
import { HealthVerdictLine } from "../components/HealthVerdictLine";
import { healthVerdict, warningTrend } from "../lib/verdict";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { RolloutsInProgress } from "../components/RolloutsInProgress";
import { rolloutsInProgress } from "../lib/rolloutsInProgress";
import { PodStatusBar } from "../components/PodStatusBar";
import { podStatusSegments } from "../lib/podStatusBar";
import { detectGatewayApi, resolveHttpRoutes, resolveIngressRoutes } from "../lib/routeResolution";

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
      daemonSets: dss.rows,
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

  // Overview v2's verdict reads the last hour of warnings for its direction.
  const events = useResourceStream(effectiveCluster || undefined, "v1/events", { mode: "full", enabled: tab === "overview" });
  // Your namespaces (the namespace filter's pick) are judged first; one click shows the rest.
  const selectedNs = useSelectedNamespaces(effectiveCluster || undefined);
  const [showAllNs, setShowAllNs] = useState(false);
  const scope = useMemo(() => (showAllNs ? [] : selectedNs), [showAllNs, selectedNs]);

  const { kinds, synced, daemonSets } = useKindCounts(pods, nodes, deployments, statefulSets, effectiveCluster || undefined);

  // SPOF Radar's own resources -- only opened once that tab is actually
  // selected, same gating discipline the Pressure tab's podMetricsQ uses.
  const spofActive = tab === "spof";
  const serviceHealthActive = tab === "service-health";
  const pdbs = useResourceStream(effectiveCluster || undefined, "policy/v1/poddisruptionbudgets", { mode: "full", enabled: spofActive });
  // services + endpointSlices shared by both SPOF Radar and Service Health tabs.
  const services = useResourceStream(effectiveCluster || undefined, "v1/services", { mode: "full", enabled: spofActive || serviceHealthActive });
  const endpointSlices = useResourceStream(effectiveCluster || undefined, "discovery.k8s.io/v1/endpointslices", { mode: "full", enabled: spofActive || serviceHealthActive });
  // Only kube-system's ConfigMaps: the Service Health tab reads the coredns Corefile from it.
  const kubeSystemConfigMaps = useResourceStream(effectiveCluster || undefined, "v1/configmaps", {
    mode: "full",
    ns: ["kube-system"],
    enabled: serviceHealthActive,
  });
  // Routing resolution (roadmap Tier 2 #13), also gated to the Service Health tab.
  // Secrets stay in metadata mode: only TLS Secret names are needed.
  const ingresses = useResourceStream(effectiveCluster || undefined, "networking.k8s.io/v1/ingresses", { mode: "full", enabled: serviceHealthActive });
  const ingressClasses = useResourceStream(effectiveCluster || undefined, "networking.k8s.io/v1/ingressclasses", { mode: "full", enabled: serviceHealthActive });
  const secrets = useResourceStream(effectiveCluster || undefined, "v1/secrets", { mode: "metadata", enabled: serviceHealthActive });
  const crdsQ = useRQQuery({
    queryKey: ["crds", effectiveCluster],
    queryFn: () => crdApi.list(effectiveCluster),
    enabled: !!effectiveCluster && serviceHealthActive,
    retry: false,
  });
  const gatewayApi = useMemo(() => detectGatewayApi(crdsQ.data ?? []), [crdsQ.data]);
  const httpRoutes = useResourceStream(effectiveCluster || undefined, gatewayApi.httpRouteGvr ?? "gateway.networking.k8s.io/v1/httproutes", {
    mode: "full",
    enabled: serviceHealthActive && !!gatewayApi.httpRouteGvr,
  });
  const gateways = useResourceStream(effectiveCluster || undefined, gatewayApi.gatewayGvr ?? "gateway.networking.k8s.io/v1/gateways", {
    mode: "full",
    enabled: serviceHealthActive && !!gatewayApi.gatewayGvr,
  });
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
    // Pressure needs it; the Overview's capacity line adds a "used" layer with it.
    enabled: !!effectiveCluster && (tab === "pressure" || tab === "overview"),
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

  // Overview v2: what's broken and why. O(pods), so throttled like Pressure.
  const attentionInputs = useLeadingThrottle(
    useMemo(
      () => ({ pods: pods.rows, deployments: deployments.rows, statefulSets: statefulSets.rows, daemonSets, nodes: nodes.rows }),
      [pods.rows, deployments.rows, statefulSets.rows, daemonSets, nodes.rows],
    ),
    2000,
  );
  const attention = useMemo(() => ({ rows: findAttention(attentionInputs), at: Date.now() }), [attentionInputs]);
  const capacity = useMemo(
    () => clusterCapacity({ pods: pressureInputs.pods, nodes: pressureInputs.nodes, usage: pressureInputs.usage }),
    [pressureInputs],
  );
  const verdict = useMemo(
    () => healthVerdict({ attention: attention.rows, pods: attentionInputs.pods, capacity, scope }),
    [attention.rows, attentionInputs.pods, capacity, scope],
  );
  const attentionShown = useMemo(
    () => (scope.length ? attention.rows.filter((r) => scope.includes(r.namespace)) : attention.rows),
    [attention.rows, scope],
  );
  const trend = useMemo(() => warningTrend(events.rows), [events.rows]);
  const inScope = useCallback((o: Record<string, unknown>) => {
    if (!scope.length) return true;
    const ns = (o.metadata as Record<string, unknown> | undefined)?.namespace;
    return typeof ns === "string" && scope.includes(ns);
  }, [scope]);
  const rollouts = useMemo(
    () =>
      rolloutsInProgress({
        deployments: attentionInputs.deployments.filter(inScope),
        statefulSets: attentionInputs.statefulSets.filter(inScope),
        daemonSets: attentionInputs.daemonSets.filter(inScope),
      }),
    [attentionInputs, inScope],
  );
  const statusSegments = useMemo(() => podStatusSegments(attentionInputs.pods.filter(inScope)), [attentionInputs.pods, inScope]);

  const serviceMismatches = useMemo(
    () => findServiceSelectorMismatches(services.rows, pods.rows, endpointSlices.rows),
    [services.rows, pods.rows, endpointSlices.rows],
  );
  const routes = useMemo(
    () => [
      ...resolveIngressRoutes({
        ingresses: ingresses.rows,
        ingressClasses: ingressClasses.rows,
        services: services.rows,
        endpointSlices: endpointSlices.rows,
        secrets: secrets.rows,
      }),
      ...(gatewayApi.httpRouteGvr
        ? resolveHttpRoutes({ httpRoutes: httpRoutes.rows, gateways: gateways.rows, services: services.rows, endpointSlices: endpointSlices.rows })
        : []),
    ],
    [ingresses.rows, ingressClasses.rows, services.rows, endpointSlices.rows, secrets.rows, gatewayApi.httpRouteGvr, httpRoutes.rows, gateways.rows],
  );
  const coreDns = useMemo(
    () => checkCoreDns(deployments.rows, pods.rows, kubeSystemConfigMaps.rows),
    [deployments.rows, pods.rows, kubeSystemConfigMaps.rows],
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
        <Stack gap={4}>
          <CoreDnsHealthCard report={coreDns} />
          <ServiceMismatchList findings={serviceMismatches} />
          <RouteResolutionList routes={routes} />
        </Stack>
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
        <Stack gap={5}>
        <HealthVerdictLine verdict={verdict} trend={trend} scope={selectedNs} showingAll={showAllNs} onToggleScope={() => setShowAllNs((v) => !v)} />
        <NeedsAttention rows={attentionShown} checkedAt={attention.at} capacity={capacity} />
        <RolloutsInProgress rows={rollouts} />
        <PodStatusBar segments={statusSegments} />
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
        <CapacityLine capacity={capacity} />
        </Stack>
      )}
      </div>
    </div>
  );
}
