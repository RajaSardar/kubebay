import { Badge, Card } from "@kubebay/ui";
import { fmtAge } from "../lib/resources";
import type { UnschedulablePod } from "../lib/karpenter";

/**
 * Backlog #3 P1's second panel: quotes the apiserver's own FailedScheduling
 * message verbatim, since that's where the actual blocking constraint lives
 * (insufficient cpu, no matching toleration, …) — Kubebay doesn't try to
 * re-derive or summarize it.
 */
export function UnschedulablePods({ rows }: { rows: UnschedulablePod[] }) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>No unschedulable pods.</p>
      </div>
    );
  }

  return (
    <Card>
      <div className="rbac-section-title">
        Unschedulable pods
        <Badge tone="err">{rows.length}</Badge>
      </div>
      <div className="table-wrap">
        <table className="kb-table">
          <thead>
            <tr><th>Namespace</th><th>Pod</th><th>Message</th><th style={{ width: 70 }}>Count</th><th style={{ width: 80 }}>Age</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="mono small">{r.ns}</td>
                <td className="mono small strong">{r.pod}</td>
                <td className="small">{r.message}</td>
                <td className="mono small">{r.count}</td>
                <td className="mono small muted">{r.lastTimestamp ? fmtAge(Date.now() - Date.parse(r.lastTimestamp)) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
