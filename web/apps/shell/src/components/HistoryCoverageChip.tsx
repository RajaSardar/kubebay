import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Row } from "@kubebay/ui";
import { historyApi } from "../lib/api";

/**
 * Backlog #36 slice 2: how much usage history this cluster has, so trend
 * features built on it are read with their coverage in view. The label is
 * the engine's own (e.g. "observed 09–18 local, weekdays only").
 */
export function HistoryCoverageChip({ cluster }: { cluster: string }) {
  const q = useQuery({
    queryKey: ["history-status", cluster],
    queryFn: () => historyApi.status(cluster),
    enabled: !!cluster,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const st = q.data;
  if (!st) return null;

  if (!st.available) {
    return <span className="muted small">History unavailable: {st.reason}</span>;
  }
  if (!st.recording) {
    return (
      <Row align="center" gap={2}>
        <Badge>History: stopped</Badge>
        <Link to="/settings" className="small">
          Settings
        </Link>
      </Row>
    );
  }
  const cov = st.coverage;
  if (!cov || cov.observedHours === 0) {
    return <Badge tone="info">History: recording, no hours yet</Badge>;
  }
  return (
    <Row align="center" gap={2} wrap>
      <Badge tone="info">{`History: observed ${cov.observedHours} of ${cov.expectedHours} hours`}</Badge>
      <span className="muted small">{cov.label}</span>
    </Row>
  );
}
