import { useMemo } from "react";
import { Badge, Card, DataTable, Row, Stack } from "@kubebay/ui";
import { useClusterHistorySeries } from "../lib/useClusterHistorySeries";
import {
  FORECAST_MIN_DAYS,
  FORECAST_MIN_HOURS_PER_DAY,
  forecastHeadroom,
  type MetricForecast,
} from "../lib/headroomForecast";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";

const LABELS: Record<MetricForecast["metric"], string> = {
  cpuRequests: "CPU requests",
  cpuUsage: "CPU usage",
  memRequests: "Memory requests",
  memUsage: "Memory usage",
};

function fmt(m: MetricForecast, v: number): string {
  return m.metric.startsWith("cpu") ? formatCpuMillis(v) : formatMemBytes(v);
}

function verdict(m: MetricForecast): string {
  switch (m.outcome) {
    case "reaches":
      return `reaches allocatable in ~${Math.max(1, Math.round(m.daysToCapacity ?? 0))} days`;
    case "at-capacity":
      return "at allocatable";
    case "flat-or-falling":
      return "flat or falling";
    case "beyond-horizon":
      return `not within ${m.horizonDays} days at this trend`;
    default:
      return `needs ${m.daysNeeded} more day${m.daysNeeded === 1 ? "" : "s"}`;
  }
}

/**
 * Roadmap Tier 2 #20 (backlog #36 slice 3): trend of the cluster's daily peak
 * against allocatable, from local usage history. Always labelled with what
 * was observed; shown with a "needs N days" note rather than hidden.
 */
export function HeadroomForecastCard({ cluster, capacity }: { cluster: string; capacity: { cpuMillis: number; memBytes: number } }) {
  const q = useClusterHistorySeries(cluster);
  const forecast = useMemo(() => (q.data ? forecastHeadroom(q.data.points, capacity) : null), [q.data, capacity]);
  // No history (stopped, unavailable, nothing recorded): the coverage chip already says why.
  if (!q.data || !forecast || forecast.metrics.length === 0) return null;

  const ready = forecast.metrics.filter((m) => m.outcome !== "not-enough-data");
  const mostDays = Math.max(...forecast.metrics.map((m) => m.days));

  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>Headroom forecast</strong>
          <Badge tone="info">daily peak during observed hours</Badge>
          <span className="muted small">{q.data.coverage.label}</span>
        </Row>
        {ready.length === 0 ? (
          <div className="muted small">
            {`The forecast needs ${FORECAST_MIN_DAYS} days with at least ${FORECAST_MIN_HOURS_PER_DAY} well-sampled hours each; ${mostDays} so far.`}
          </div>
        ) : (
          <>
            <div className="muted small">
              A straight-line trend of each day's peak, from hours Kubebay was open. Hours it wasn't open are left out, not
              guessed, so a peak outside them won't show here.
            </div>
            <DataTable
              rows={forecast.metrics}
              rowKey={(m) => m.metric}
              columns={[
                { key: "metric", header: "Resource", className: "small", render: (m) => LABELS[m.metric] },
                {
                  key: "latest",
                  header: "Daily peak",
                  className: "mono small",
                  render: (m) => (m.days > 0 ? fmt(m, m.outcome === "not-enough-data" ? m.peaks.at(-1)!.value : m.latest) : "—"),
                },
                {
                  key: "trend",
                  header: "Trend / day",
                  className: "mono small",
                  render: (m) =>
                    m.outcome === "not-enough-data" ? "—" : `${m.slopePerDay >= 0 ? "+" : "−"}${fmt(m, Math.abs(m.slopePerDay))}`,
                },
                { key: "cap", header: "Allocatable", className: "mono small", render: (m) => fmt(m, m.capacity) },
                { key: "verdict", header: "Forecast", className: "small strong", render: (m) => verdict(m) },
              ]}
            />
          </>
        )}
      </Stack>
    </Card>
  );
}
