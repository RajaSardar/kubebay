import { useMemo } from "react";
import { Badge, Card, DataTable, Row, Stack } from "@kubebay/ui";
import { ANOMALY_MIN_BASELINE_DAYS, findUsageAnomalies, type UsageAnomaly } from "../lib/usageAnomaly";
import { useClusterHistorySeries } from "../lib/useClusterHistorySeries";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";

const LABELS: Record<UsageAnomaly["metric"], string> = {
  cpuUsage: "CPU usage",
  memUsage: "Memory usage",
  cpuRequests: "CPU requests",
  memRequests: "Memory requests",
};

function fmt(a: UsageAnomaly, v: number): string {
  return a.metric.startsWith("cpu") ? formatCpuMillis(v) : formatMemBytes(v);
}

function ratioLabel(a: UsageAnomaly): string {
  if (!Number.isFinite(a.ratio)) return "new";
  return a.direction === "up" ? `${a.ratio.toFixed(1)}× usual` : `${Math.round(a.ratio * 100)}% of usual`;
}

function dayKind(at: string): string {
  const d = new Date(at).getDay();
  return d === 0 || d === 6 ? "weekend days" : "weekdays";
}

/**
 * Roadmap Tier 2 #21 (backlog #36 slice 3b): cluster-total hours in the last
 * day that stand out against the same hour on earlier days of the same kind.
 */
export function UsageAnomalyCard({ cluster, now }: { cluster: string; now?: Date }) {
  const q = useClusterHistorySeries(cluster);
  const anomalies = useMemo(() => (q.data ? findUsageAnomalies(q.data.points, { now }) : null), [q.data, now]);
  // No history (stopped, unavailable, nothing recorded): the coverage chip already says why.
  if (!q.data || !anomalies) return null;

  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>Unusual usage</strong>
          {anomalies.length > 0 && <Badge tone="warn">{`${anomalies.length} in the last 24 hours`}</Badge>}
          <span className="muted small">{q.data.coverage.label}</span>
        </Row>
        {anomalies.length === 0 ? (
          <div className="muted small">
            {`Nothing unusual in the last 24 hours. Each hour is compared with the same hour on at least ${ANOMALY_MIN_BASELINE_DAYS} earlier days of the same kind (weekday or weekend); hours without that much history aren't judged.`}
          </div>
        ) : (
          <DataTable
            rows={anomalies}
            rowKey={(a) => `${a.at}|${a.metric}`}
            columns={[
              {
                key: "at",
                header: "Hour",
                className: "mono small",
                render: (a) => new Date(a.at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
              },
              { key: "metric", header: "Resource", className: "small", render: (a) => LABELS[a.metric] },
              {
                key: "ratio",
                header: "Change",
                render: (a) => <Badge tone={a.direction === "up" ? "warn" : "info"}>{ratioLabel(a)}</Badge>,
              },
              {
                key: "value",
                header: "Value",
                className: "mono small",
                render: (a) => `${fmt(a, a.value)} (usual ${fmt(a, a.usual)})`,
              },
              {
                key: "base",
                header: "Compared with",
                className: "muted small",
                render: (a) => `same hour on ${a.baselineDays} earlier ${dayKind(a.at)}`,
              },
            ]}
          />
        )}
      </Stack>
    </Card>
  );
}
