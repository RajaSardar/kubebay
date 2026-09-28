import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, DataTable, EmptyState, InlineBanner, PageHeader, StatusDot, TextField } from "@kubebay/ui";
import { api } from "../lib/api";

interface AuditEntry {
  time: string;
  action: string;
  cluster: string;
  namespace?: string;
  resource?: string;
  detail?: string;
  userAgent?: string;
}

const ACTION_DOT: Record<string, string> = {
  delete: "unreachable",
  drain: "unreachable",
  exec: "degraded",
  "port-forward": "degraded",
  scale: "connected",
  restart: "connected",
  cordon: "degraded",
  apply: "connected",
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

export default function AuditLog() {
  const [filter, setFilter] = useState("");

  const q = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.auditLog(),
    refetchInterval: 10_000,
    retry: false,
  });

  const entries: AuditEntry[] = q.data ?? [];
  const filtered = filter
    ? entries.filter((e) =>
        e.action.includes(filter) ||
        e.cluster.includes(filter) ||
        (e.resource ?? "").includes(filter) ||
        (e.namespace ?? "").includes(filter) ||
        (e.detail ?? "").includes(filter),
      )
    : entries;
  // Most recent first
  const sorted = [...filtered].reverse();

  return (
    <div className="page">
      <PageHeader level={2} title="Audit Log" />

      <div className="toolbar">
        <TextField
          placeholder="Filter by action, cluster, resource…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <Badge>{sorted.length}</Badge>
      </div>

      {q.isError && (
        <InlineBanner flush style={{ margin: "8px 0" }}>
          {String(q.error instanceof Error ? q.error.message : q.error)}
        </InlineBanner>
      )}

      {!q.isError && (
        <DataTable
          loading={q.isLoading}
          rows={sorted}
          rowKey={(_, i) => String(i)}
          empty={
            <EmptyState
              title="No audit entries yet."
              hint="Actions like scale, delete, exec, and port-forward appear here."
            />
          }
          columns={[
            { key: "time", header: "Time", width: 160, className: "mono muted small", render: (e) => fmtTime(e.time) },
            {
              key: "action",
              header: "Action",
              width: 110,
              render: (e) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <StatusDot
                    status={
                      ACTION_DOT[e.action] === "connected" ? "connected" : ACTION_DOT[e.action] === "unreachable" ? "unreachable" : "degraded"
                    }
                  />
                  <span className="mono">{e.action}</span>
                </span>
              ),
            },
            { key: "cluster", header: "Cluster", width: 130, className: "mono muted small", render: (e) => e.cluster },
            { key: "ns", header: "Namespace", width: 110, className: "mono muted small", render: (e) => e.namespace || "–" },
            {
              key: "resource",
              header: "Resource",
              width: 160,
              className: "mono strong small",
              title: (e) => e.resource,
              render: (e) => e.resource || "–",
            },
            { key: "detail", header: "Detail", className: "mono muted small", render: (e) => e.detail || "–" },
          ]}
        />
      )}
    </div>
  );
}
