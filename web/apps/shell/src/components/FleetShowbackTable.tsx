import { DataTable, EmptyState, NsPill } from "@kubebay/ui";
import type { ShowbackRow } from "../lib/fleetShowback";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";

/** Roadmap Tier 2 #19: namespace showback across the fleet, below the per-cluster waste cards. */
export function FleetShowbackTable({ rows }: { rows: ShowbackRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        <p>No usage data from any cluster yet (needs metrics-server or Prometheus).</p>
      </EmptyState>
    );
  }
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.ns}
      columns={[
        { key: "ns", header: "Namespace", render: (r) => <NsPill>{r.ns}</NsPill> },
        { key: "clusters", header: "Clusters", className: "mono small", render: (r) => r.clusters.join(", ") },
        { key: "workloads", header: "Workloads", className: "mono small", render: (r) => r.workloads },
        {
          key: "requested",
          header: "Requested",
          className: "mono small",
          render: (r) => `${formatCpuMillis(r.requestedCpuMillis)} / ${formatMemBytes(r.requestedMemBytes)}`,
        },
        {
          key: "p95",
          header: "Sum of p95 usage",
          className: "mono small",
          render: (r) => `${formatCpuMillis(r.p95CpuMillis)} / ${formatMemBytes(r.p95MemBytes)}`,
        },
        {
          key: "wasted",
          header: "Wasted",
          className: "mono small strong",
          render: (r) => `${formatCpuMillis(r.wastedCpuMillis)} / ${formatMemBytes(r.wastedMemBytes)}`,
        },
      ]}
    />
  );
}
