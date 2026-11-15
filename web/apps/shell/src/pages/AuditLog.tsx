import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, DataTable, EmptyState, InlineBanner, Modal, PageHeader, Row, Stack, StatusDot, TextField } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
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
  const [detail, setDetail] = useState<AuditEntry | null>(null);

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
      <PageHeader help={<PageHelp route="/audit" />} level={2} title="Audit Log" />

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

      {detail && (
        <Modal label="Audit entry details" onClose={() => setDetail(null)} placement="center" size="wide">
          <Stack gap={3} style={{ padding: "24px 28px" }}>
            {(
              [
                ["Time", fmtTime(detail.time)],
                ["Action", detail.action],
                ["Cluster", detail.cluster],
                ["Namespace", detail.namespace || "–"],
                ["Resource", detail.resource || "–"],
                ["Detail", detail.detail || "–"],
                ["User-Agent", detail.userAgent || "–"],
              ] as [string, string][]
            ).map(([label, value]) => (
              <Row key={label} gap={3} style={{ borderBottom: "1px solid var(--kb-border-subtle)", paddingBottom: 6 }}>
                <span style={{ width: 120, flexShrink: 0, color: "var(--kb-fg-muted)", fontSize: "var(--kb-text-sm)", whiteSpace: "nowrap" }}>
                  {label}
                </span>
                <span className="mono small" style={{ wordBreak: "break-all" }}>
                  {value}
                </span>
              </Row>
            ))}
            <Row gap={2} style={{ justifyContent: "flex-end" }}>
              <Button onClick={() => setDetail(null)}>Close</Button>
            </Row>
          </Stack>
        </Modal>
      )}

      {!q.isError && (
        <DataTable
          loading={q.isLoading}
          loadingLabel="Loading audit log…"
          rows={sorted}
          rowKey={(_, i) => String(i)}
          onRowClick={(e) => setDetail(e)}
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
