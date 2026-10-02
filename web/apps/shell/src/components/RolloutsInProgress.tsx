import { useId } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, CellLink, DataTable, NsPill, Row, Stack, StatusPill, type Column } from "@kubebay/ui";
import { podsOfWorkloadPath } from "../lib/selector";
import type { RolloutRow } from "../lib/rolloutsInProgress";

function ShowPods({ r }: { r: RolloutRow }) {
  const navigate = useNavigate();
  const to = podsOfWorkloadPath(r.workload, r.kind);
  if (!to) return null;
  return (
    <CellLink
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      Show pods
    </CellLink>
  );
}

/** Updated of desired as a thin zero-based bar. */
function Progress({ r }: { r: RolloutRow }) {
  const pct = r.desired > 0 ? Math.min(100, (r.updated / r.desired) * 100) : 0;
  return (
    <div
      role="img"
      aria-label={`${r.updated} of ${r.desired} updated`}
      style={{ height: 6, borderRadius: "var(--kb-radius-xs)", background: "var(--kb-bg-inset)", overflow: "hidden" }}
    >
      <div style={{ height: "100%", width: `${pct}%`, background: r.stalled ? "var(--kb-status-err)" : "var(--kb-status-pending)" }} />
    </div>
  );
}

const columns: Column<RolloutRow>[] = [
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
  },
  { key: "ns", header: "Namespace", width: 130, render: (r) => <NsPill>{r.namespace}</NsPill> },
  {
    key: "progress",
    header: "Progress",
    render: (r) => (
      <Stack gap={1}>
        <span className="small">{`${r.updated} of ${r.desired} updated · ${r.ready} ready`}</span>
        <Progress r={r} />
      </Stack>
    ),
  },
  {
    key: "state",
    header: "State",
    render: (r) => (
      <Stack gap={0}>
        <span>
          <StatusPill tone={r.stalled ? "err" : "pending"}>{r.stalled ? "Stalled" : "Rolling out"}</StatusPill>
        </span>
        {r.reason && <span className="muted small">{r.reason}</span>}
      </Stack>
    ),
  },
  { key: "go", header: "", width: 100, render: (r) => <ShowPods r={r} /> },
];

/** Overview v2: what is rolling out now, like CI steps; drawn only while something is. */
export function RolloutsInProgress({ rows }: { rows: RolloutRow[] }) {
  const id = useId();
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <Stack gap={2}>
        <Row gap={2} align="center">
          <strong id={id}>Rollouts in progress</strong>
          <Badge tone={rows.some((r) => r.stalled) ? "err" : "info"}>{rows.length}</Badge>
        </Row>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
      </Stack>
    </section>
  );
}
