import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Skeleton } from "@kubebay/ui";
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
      <div className="page-header">
        <h2>Audit Log</h2>
      </div>

      <div className="toolbar">
        <input
          className="toolbar-input"
          placeholder="Filter by action, cluster, resource…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <Badge>{sorted.length}</Badge>
      </div>

      {q.isLoading && (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>
                <th>Time</th><th>Action</th><th>Cluster</th><th>Namespace</th><th>Resource</th><th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {[0,1,2,3,4].map((i) => (
                <tr key={i}>
                  {[90,60,80,80,120,160].map((w, j) => <td key={j}><Skeleton w={w} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {q.isError && (
        <div className="error-banner" style={{ margin: "8px 0" }}>
          {String(q.error instanceof Error ? q.error.message : q.error)}
        </div>
      )}

      {!q.isLoading && sorted.length === 0 && !q.isError && (
        <div className="empty-state">
          <p>No audit entries yet.</p>
          <p className="muted small">Actions like scale, delete, exec, and port-forward appear here.</p>
        </div>
      )}

      {!q.isLoading && sorted.length > 0 && (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>
                <th style={{ width: 160 }}>Time</th>
                <th style={{ width: 110 }}>Action</th>
                <th style={{ width: 130 }}>Cluster</th>
                <th style={{ width: 110 }}>Namespace</th>
                <th style={{ width: 160 }}>Resource</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, i) => (
                <tr key={i}>
                  <td className="mono muted small">{fmtTime(e.time)}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span
                        className="status-dot"
                        style={{ background: `var(--kb-status-${ACTION_DOT[e.action] === "connected" ? "ok" : ACTION_DOT[e.action] === "unreachable" ? "err" : "warn"})` }}
                      />
                      <span className="mono">{e.action}</span>
                    </span>
                  </td>
                  <td className="mono muted small">{e.cluster}</td>
                  <td className="mono muted small">{e.namespace || "–"}</td>
                  <td className="mono strong small" title={e.resource}>{e.resource || "–"}</td>
                  <td className="mono muted small">{e.detail || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
