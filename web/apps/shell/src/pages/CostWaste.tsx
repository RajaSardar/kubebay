import { useMemo } from "react";
import { WasteBreakdown } from "../components/WasteBreakdown";
import { PageLoader } from "../components/PageLoader";
import { useResourceStream, shouldShowSkeleton } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { computeClusterWaste } from "../lib/waste";

export default function CostWaste() {
  const { cluster: effectiveCluster } = useCluster();

  // mode:"full" is load-bearing here: `.status.allocatable` and pod
  // `.spec.containers[].resources` are both stripped in metadata mode.
  const nodes = useResourceStream(effectiveCluster || undefined, "v1/nodes", { mode: "full" });
  const pods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full" });

  const waste = useMemo(() => computeClusterWaste(nodes.rows, pods.rows), [nodes.rows, pods.rows]);

  if (!effectiveCluster) {
    return (
      <div className="page">
        <div className="page-header"><h2>Cost / Waste</h2></div>
        <div className="empty-state"><p>Select a cluster first.</p></div>
      </div>
    );
  }

  if (shouldShowSkeleton(nodes.synced, nodes.rows.length) || shouldShowSkeleton(pods.synced, pods.rows.length)) {
    return (
      <div className="page">
        <div className="page-header"><h2>Cost / Waste</h2></div>
        <PageLoader message="Computing capacity accounting…" />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          Cost / Waste
          <span className="page-header-count">· {nodes.rows.length} nodes</span>
        </h2>
        <div />
      </div>
      <div className="page-body">
        <div className="muted small" style={{ marginBottom: 12 }}>
          Tier 0: allocatable minus requests, computed directly from the live cluster — no metrics required, so this
          is exact and never stale. It can't see actual usage, only what's requested; a usage-aware tier is a
          follow-on (see Right-sizing for per-workload recommendations once a VPA is installed). No dollar figures —
          Kubebay doesn't guess at your pricing.
        </div>
        <WasteBreakdown waste={waste} />
      </div>
    </div>
  );
}
