import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  formatCpuMillis,
  formatMemBytes,
  computeRightSizingRows,
  computeEngineRightSizingRows,
  mergeRightSizingRows,
  summarizeForWorkload,
  gvrForWorkloadKind,
  type WorkloadRightSizingSummary,
} from "../lib/rightsizing";
import { useResourceStream } from "../lib/useResourceStream";
import { wasteApi } from "../lib/api";

/**
 * Pure rendering half — "discovery requires you to already be on the
 * Right-sizing page" is the gap backlog #4 v3 closes: this puts the same
 * opportunity right on the resource's own drawer, linking back to the full
 * ranked view rather than duplicating its apply flow here.
 */
export function RightSizingBannerView({ summary }: { summary: WorkloadRightSizingSummary | null }) {
  if (!summary) return null;
  return (
    <div className="inline-banner" role="status" style={{ marginBottom: 12 }}>
      Right-sizing opportunity: {formatCpuMillis(summary.wastedCpuMillis)} / {formatMemBytes(summary.wastedMemBytes)}{" "}
      wasted. <Link to="/right-sizing">View in Right-sizing →</Link>
    </div>
  );
}

/**
 * Data-fetching half. Streams only the one workload kind this drawer is
 * open on (via gvrForWorkloadKind) rather than all three, since the target
 * kind is already known — lighter than the full Right-sizing page's streams.
 */
export function RightSizingBanner({
  cluster,
  ns,
  name,
  kind,
}: {
  cluster: string;
  ns: string;
  name: string;
  kind: string;
}) {
  const workloadGvr = gvrForWorkloadKind(kind);
  const vpas = useResourceStream(cluster, "autoscaling.k8s.io/v1/verticalpodautoscalers", { mode: "full", enabled: !!workloadGvr });
  const workloads = useResourceStream(cluster, workloadGvr || "v1/configmaps", { mode: "full", enabled: !!workloadGvr });
  const hpas = useResourceStream(cluster, "autoscaling/v2/horizontalpodautoscalers", { mode: "full", enabled: !!workloadGvr });
  const wasteQ = useQuery({
    queryKey: ["waste-workloads", cluster],
    queryFn: () => wasteApi.workloads(cluster),
    enabled: !!cluster && !!workloadGvr,
    refetchInterval: 30_000,
    retry: false,
  });

  const summary = useMemo(() => {
    if (!workloadGvr) return null;
    const vpaRows = computeRightSizingRows({ vpas: vpas.rows, workloads: workloads.rows, hpas: hpas.rows });
    const engineRows = computeEngineRightSizingRows(wasteQ.data ?? [], hpas.rows);
    const merged = mergeRightSizingRows(vpaRows, engineRows);
    return summarizeForWorkload(merged, { ns, kind, name });
  }, [workloadGvr, vpas.rows, workloads.rows, hpas.rows, wasteQ.data, ns, kind, name]);

  return <RightSizingBannerView summary={summary} />;
}
