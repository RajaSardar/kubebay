import { Card, DataTable, EmptyState } from "@kubebay/ui";
import { formatCpuMillis, formatMemBytes, type RightSizingRow } from "../lib/rightsizing";

/**
 * Cost/Waste Phase 1: the same shared usage recommender that powers
 * Right-sizing's ranked view (one recommender, two renderers, per the
 * backlog's #4/#6 boundary note) — here as a plain sorted table rather than
 * an actionable list, since Cost/Waste stays read-only.
 */
export function WorkloadUsageTable({ rows }: { rows: RightSizingRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        <p>No usage-based recommendations yet.</p>
        <p className="muted small">
          Kubebay samples metrics-server every 60s; this fills in once a workload has enough observed usage to
          differ materially from its requests.
        </p>
      </EmptyState>
    );
  }

  return (
    <Card>
      <div className="rbac-section-title">Workload usage vs requests</div>
      <DataTable
        rows={rows}
        rowKey={(r, i) => `${r.ns}/${r.workloadName}/${i}`}
        columns={[
          { key: "w", header: "Workload", className: "mono small strong", render: (r) => r.workloadName },
          { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.ns },
          {
            key: "req",
            header: "Requested",
            className: "mono small",
            render: (r) => `${formatCpuMillis(r.currentCpuMillis)} / ${formatMemBytes(r.currentMemBytes)}`,
          },
          {
            key: "p95",
            header: "Observed p95",
            className: "mono small",
            render: (r) => `${formatCpuMillis(r.targetCpuMillis)} / ${formatMemBytes(r.targetMemBytes)}`,
          },
          {
            key: "waste",
            header: "Wasted",
            className: "mono small",
            render: (r) => `${formatCpuMillis(r.wastedCpuMillis)} / ${formatMemBytes(r.wastedMemBytes)}`,
          },
          { key: "window", header: "Window", className: "muted small", render: (r) => r.window },
        ]}
      />
    </Card>
  );
}
