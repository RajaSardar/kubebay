import { Badge, Card, DataTable, EmptyState } from "@kubebay/ui";
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
      <EmptyState>
        <p>No unschedulable pods.</p>
      </EmptyState>
    );
  }

  return (
    <Card>
      <div className="rbac-section-title">
        Unschedulable pods
        <Badge tone="err">{rows.length}</Badge>
      </div>
      <DataTable
        rows={rows}
        rowKey={(r, i) => `${r.ns}/${r.pod}/${i}`}
        columns={[
          { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.ns },
          { key: "pod", header: "Pod", className: "mono small strong", render: (r) => r.pod },
          { key: "msg", header: "Message", className: "small", render: (r) => r.message },
          { key: "count", header: "Count", width: 70, className: "mono small", render: (r) => r.count },
          {
            key: "age",
            header: "Age",
            width: 80,
            className: "mono small muted",
            render: (r) => (r.lastTimestamp ? fmtAge(Date.now() - Date.parse(r.lastTimestamp)) : "–"),
          },
        ]}
      />
    </Card>
  );
}
