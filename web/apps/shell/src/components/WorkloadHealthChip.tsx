import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Row, StatusDot } from "@kubebay/ui";
import { historyApi } from "../lib/api";

/** Fewer recorded hours than this say too little to call anything chronic. */
const MIN_RECORDED_HOURS = 24;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Overview v2, in the workload drawer: is this workload's trouble chronic?
 * From recorded history only (the cluster must be recording), over the last
 * 7 days, with recorded hours and days as the denominator, never 7 × 24.
 * Renders nothing until there are 24 recorded hours, or when history has
 * nothing for this cluster.
 */
export function WorkloadHealthChip({ cluster, obj, style }: { cluster: string; obj: Record<string, unknown> | null; style?: CSSProperties }) {
  const meta = (obj?.metadata ?? {}) as Record<string, unknown>;
  const kind = typeof obj?.kind === "string" ? obj.kind : "";
  const ns = String(meta.namespace ?? "");
  const name = String(meta.name ?? "");
  const created = typeof meta.creationTimestamp === "string" ? meta.creationTimestamp : undefined;

  const status = useQuery({
    queryKey: ["history-status", cluster],
    queryFn: () => historyApi.status(cluster),
    enabled: !!cluster,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const recording = !!status.data?.available && !!status.data.recording;
  const health = useQuery({
    queryKey: ["history-health", cluster, ns, kind, name, created],
    queryFn: () => historyApi.health(cluster, ns, kind, name, created),
    enabled: recording && !!kind && !!ns && !!name,
    refetchInterval: 10 * 60_000,
    retry: false,
  });

  const h = health.data;
  if (!recording || !h || h.recordedHours < MIN_RECORDED_HOURS) return null;
  const broken = h.brokenHours > 0;
  return (
    <Row gap={2} align="center" wrap style={style}>
      <StatusDot status={broken ? "warn" : "ok"} />
      <span className="small">
        {broken
          ? `Broken in ${h.brokenHours} of ${plural(h.recordedHours, "recorded hour")}, on ${h.brokenDays} of ${plural(h.recordedDays, "recorded day")}`
          : `No trouble in ${plural(h.recordedHours, "recorded hour")}`}
      </span>
      <span className="muted small">Last 7 days</span>
    </Row>
  );
}
