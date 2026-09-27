import { Card } from "@kubebay/ui";
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
      <div className="empty-state">
        <p>No usage-based recommendations yet.</p>
        <p className="muted small">
          Kubebay samples metrics-server every 60s; this fills in once a workload has enough observed usage to
          differ materially from its requests.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <div className="rbac-section-title">Workload usage vs requests</div>
      <div className="table-wrap">
        <table className="kb-table">
          <thead>
            <tr><th>Workload</th><th>Namespace</th><th>Requested</th><th>Observed p95</th><th>Wasted</th><th>Window</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="mono small strong">{r.workloadName}</td>
                <td className="mono small">{r.ns}</td>
                <td className="mono small">
                  {formatCpuMillis(r.currentCpuMillis)} / {formatMemBytes(r.currentMemBytes)}
                </td>
                <td className="mono small">
                  {formatCpuMillis(r.targetCpuMillis)} / {formatMemBytes(r.targetMemBytes)}
                </td>
                <td className="mono small">
                  {formatCpuMillis(r.wastedCpuMillis)} / {formatMemBytes(r.wastedMemBytes)}
                </td>
                <td className="muted small">{r.window}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
