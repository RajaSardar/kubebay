import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@kubebay/ui";
import { WasteBreakdown } from "../components/WasteBreakdown";
import { WorkloadUsageTable } from "../components/WorkloadUsageTable";
import { PageLoader } from "../components/PageLoader";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { wasteApi } from "../lib/api";
import { computeClusterWaste } from "../lib/waste";
import { computeEngineRightSizingRows } from "../lib/rightsizing";

export default function CostWaste() {
  const { cluster: effectiveCluster } = useCluster();

  // mode:"full" is load-bearing here: `.status.allocatable` and pod
  // `.spec.containers[].resources` are both stripped in metadata mode.
  const nodes = useResourceStream(effectiveCluster || undefined, "v1/nodes", { mode: "full" });
  const pods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full" });
  const hpas = useResourceStream(effectiveCluster || undefined, "autoscaling/v2/horizontalpodautoscalers", { mode: "full" });

  const wasteQ = useQuery({
    queryKey: ["waste-workloads", effectiveCluster],
    queryFn: () => wasteApi.workloads(effectiveCluster),
    enabled: !!effectiveCluster,
    refetchInterval: 30_000,
    retry: false,
  });

  const waste = useMemo(() => computeClusterWaste(nodes.rows, pods.rows), [nodes.rows, pods.rows]);
  const usageRows = useMemo(() => computeEngineRightSizingRows(wasteQ.data ?? [], hpas.rows), [wasteQ.data, hpas.rows]);

  if (!effectiveCluster) {
    return (
      <div className="page">
        <PageHeader level={2} title="Cost / Waste" />
        <div className="empty-state"><p>Select a cluster first.</p></div>
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
        <WasteBreakdown waste={waste} />
        <div style={{ marginTop: 16 }}>
          <WorkloadUsageTable rows={usageRows} />
        </div>
      </div>
    </div>
  );
}
