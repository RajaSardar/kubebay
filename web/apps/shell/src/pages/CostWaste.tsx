import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@kubebay/ui";
import { WasteBreakdown } from "../components/WasteBreakdown";
import { HistoryCoverageChip } from "../components/HistoryCoverageChip";
import { HeadroomForecastCard } from "../components/HeadroomForecastCard";
import { WorkloadUsageTable } from "../components/WorkloadUsageTable";
import { PageLoader } from "../components/PageLoader";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { wasteApi } from "../lib/api";
import { computeClusterWaste } from "../lib/waste";
import { computeEngineRightSizingRows } from "../lib/rightsizing";
import { SpotRiskCard } from "../components/SpotRiskCard";
import { findSpotRiskWorkloads, isSpotNode } from "../lib/spotRisk";
import { EfficiencyScoreCard } from "../components/EfficiencyScoreCard";
import { computeEfficiencyScore } from "../lib/efficiencyScore";
import { GpuCapacityCard } from "../components/GpuCapacityCard";
import { computeGpuCapacity } from "../lib/gpuCapacity";
import { ConsolidationCard } from "../components/ConsolidationCard";
import { assessConsolidation } from "../lib/consolidation";

export default function CostWaste() {
  const { cluster: effectiveCluster } = useCluster();

  // mode:"full" is load-bearing here: `.status.allocatable` and pod
  // `.spec.containers[].resources` are both stripped in metadata mode.
  const nodes = useResourceStream(effectiveCluster || undefined, "v1/nodes", { mode: "full" });
  const pods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full" });
  const hpas = useResourceStream(effectiveCluster || undefined, "autoscaling/v2/horizontalpodautoscalers", { mode: "full" });
  const pdbs = useResourceStream(effectiveCluster || undefined, "policy/v1/poddisruptionbudgets", { mode: "full" });
  // Full mode: SPOF Radar's gate reads spec.replicas and spec.selector.
  const deployments = useResourceStream(effectiveCluster || undefined, "apps/v1/deployments", { mode: "full" });
  const statefulSets = useResourceStream(effectiveCluster || undefined, "apps/v1/statefulsets", { mode: "full" });

  const wasteQ = useQuery({
    queryKey: ["waste-workloads", effectiveCluster],
    queryFn: () => wasteApi.workloads(effectiveCluster),
    enabled: !!effectiveCluster,
    refetchInterval: 30_000,
    retry: false,
  });

  const waste = useMemo(() => computeClusterWaste(nodes.rows, pods.rows), [nodes.rows, pods.rows]);
  const usageRows = useMemo(() => computeEngineRightSizingRows(wasteQ.data ?? [], hpas.rows), [wasteQ.data, hpas.rows]);
  const efficiency = useMemo(() => computeEfficiencyScore(waste, pods.rows, wasteQ.data), [waste, pods.rows, wasteQ.data]);
  const capacity = useMemo(
    () => ({
      cpuMillis: waste.nodes.reduce((a, n) => a + n.allocatableCpuMillis, 0),
      memBytes: waste.nodes.reduce((a, n) => a + n.allocatableMemBytes, 0),
    }),
    [waste],
  );
  const consolidation = useMemo(
    () =>
      assessConsolidation({
        nodes: nodes.rows,
        pods: pods.rows,
        pdbs: pdbs.rows,
        deployments: deployments.rows,
        statefulSets: statefulSets.rows,
      }),
    [nodes.rows, pods.rows, pdbs.rows, deployments.rows, statefulSets.rows],
  );
  const gpu = useMemo(() => computeGpuCapacity(nodes.rows, pods.rows), [nodes.rows, pods.rows]);
  const spotNodeCount = useMemo(() => nodes.rows.filter(isSpotNode).length, [nodes.rows]);
  const spotRisk = useMemo(() => findSpotRiskWorkloads(pods.rows, nodes.rows, pdbs.rows), [pods.rows, nodes.rows, pdbs.rows]);

  if (!effectiveCluster) {
    return (
      <div className="page">
        <PageHeader level={2} title="Cost / Waste" />
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }

  if (shouldShowSkeleton(nodes.synced, nodes.rows.length) || shouldShowSkeleton(pods.synced, pods.rows.length)) {
    return (
      <div className="page">
        <PageHeader level={2} title="Cost / Waste" />
        <PageLoader message="Computing capacity accounting…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader level={2} title="Cost / Waste" count={`· ${nodes.rows.length} nodes`} />
      <div className="page-body">
        <div className="muted small" style={{ marginBottom: 12 }}>
          Tier 0: allocatable minus requests, computed directly from the live cluster — no metrics required, so this
          is exact and never stale. No dollar figures — Kubebay doesn't guess at your pricing.
        </div>
        <div style={{ marginBottom: 12 }}>
          <HistoryCoverageChip cluster={effectiveCluster} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <HeadroomForecastCard cluster={effectiveCluster} capacity={capacity} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <EfficiencyScoreCard efficiency={efficiency} />
        </div>
        <WasteBreakdown waste={waste} />
        <div style={{ marginTop: 16 }}>
          <WorkloadUsageTable rows={usageRows} />
        </div>
        {gpu.totals.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <GpuCapacityCard gpu={gpu} />
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          {/* The SPOF gate needs workloads and PDBs; until they sync a node would look safer than it is. */}
          {deployments.synced && statefulSets.synced && pdbs.synced ? (
            <ConsolidationCard result={consolidation} />
          ) : (
            <div className="muted small">Node consolidation: checking workloads for single points of failure…</div>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <SpotRiskCard findings={spotRisk} spotNodeCount={spotNodeCount} />
        </div>
      </div>
    </div>
  );
}
