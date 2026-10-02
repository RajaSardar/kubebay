import { useId, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, CellLink, DataTable, EmptyState, NsPill, Row, Stack, StatusDot, StatusPill, type Column } from "@kubebay/ui";
import { LiveAge } from "./LiveAge";
import { podsOfWorkloadPath } from "../lib/selector";
import type { AttentionRow } from "../lib/attention";
import type { ClusterCapacity } from "../lib/capacity";

/** Pods page for a row: the workload's own pods, or a bare pod by name. */
export function podsPath(r: AttentionRow): string {
  if (r.workload) {
    const p = podsOfWorkloadPath(r.workload, r.kind);
    if (p) return p;
  }
  return `/workloads?${new URLSearchParams({ q: `name:${r.name} ns:${r.namespace}` }).toString()}`;
}

/** The Pods page opened on one pod's logs. */
export function logsPath(podKey: string): string {
  return `/workloads?${new URLSearchParams({ pod: podKey, tab: "logs" }).toString()}`;
}

function Link({ to, children }: { to: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <CellLink
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </CellLink>
  );
}

function makeColumns(capacity: ClusterCapacity | null | undefined): Column<AttentionRow>[] {
  return [
    {
      key: "name",
      header: "Workload",
      className: "mono td-name",
      render: (r) => (
        <Stack gap={0}>
          <span>{r.name}</span>
          <span className="muted small">{r.kind}</span>
        </Stack>
      ),
      title: (r) => `${r.kind} ${r.namespace}/${r.name}`,
    },
    { key: "ns", header: "Namespace", width: 130, render: (r) => <NsPill>{r.namespace}</NsPill> },
    {
      key: "problem",
      header: "Problem",
      render: (r) => (
        <Stack gap={0}>
          <span>
            <StatusPill tone={r.severity}>{r.plain}</StatusPill>
          </span>
          <span className="muted small mono">{r.restarts > 0 ? `${r.code} · ${r.restarts} restarts` : r.code}</span>
          {r.code === "Unschedulable" && capacity && (
            <span className="muted small">{`Cluster: CPU ${capacity.cpu.pct}% · memory ${capacity.memory.pct}% requested`}</span>
          )}
        </Stack>
      ),
      title: (r) => r.detail || undefined,
    },
    { key: "ready", header: "Ready", width: 80, className: "cell-secondary", render: (r) => `${r.ready} of ${r.desired}` },
    {
      key: "since",
      header: "Since",
      width: 70,
      className: "cell-secondary",
      render: (r) => (r.since !== undefined ? <LiveAge ts={new Date(r.since).toISOString()} /> : "–"),
      title: (r) => (r.since !== undefined ? new Date(r.since).toLocaleString() : undefined),
    },
    {
      key: "go",
      header: "",
      width: 170,
      render: (r) => (
        <Row gap={3} as="span">
          <Link to={podsPath(r)}>Show pods</Link>
          {r.pods[0] && <Link to={logsPath(r.pods[0])}>Show logs</Link>}
        </Row>
      ),
    },
  ];
}

/**
 * Overview v2's focal point: every broken workload, worst first, with what
 * broke in plain words (the Kubernetes term kept beside it), ready of desired,
 * when it started, and one click to its pods or its worst pod's logs. Calm
 * when nothing is broken.
 */
export function NeedsAttention({
  rows,
  checkedAt,
  capacity,
}: {
  rows: AttentionRow[];
  checkedAt: number;
  /** Shown on rows that can't find room, so the cause sits beside the symptom. */
  capacity?: ClusterCapacity | null;
}) {
  const id = useId();
  const columns = useMemo(() => makeColumns(capacity), [capacity]);
  return (
    <section aria-labelledby={id}>
      <Stack gap={2}>
        <Row gap={2} align="center">
          <strong id={id}>Needs attention</strong>
          <Badge tone={rows.length ? (rows.some((r) => r.severity === "err") ? "err" : "warn") : undefined}>{rows.length}</Badge>
        </Row>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          empty={
            <EmptyState
              title={
                <Row gap={2} align="center" as="span">
                  <StatusDot status="ok" />
                  <span>Nothing needs attention</span>
                </Row>
              }
              hint={`Checked ${new Date(checkedAt).toLocaleTimeString()}`}
            />
          }
        />
      </Stack>
    </section>
  );
}
