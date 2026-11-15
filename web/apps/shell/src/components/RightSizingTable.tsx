import { Badge, DataTable, EmptyState } from "@kubebay/ui";
import { formatCpuMillis, formatMemBytes, type RightSizingRow } from "../lib/rightsizing";
import { ownerLabel } from "../lib/gitops";

/** Stable identity for a row — one workload's one container. */
export function rowKey(r: RightSizingRow): string {
  return `${r.ns}/${r.workloadKind}/${r.workloadName}/${r.container}`;
}

export type Dim = "cpu" | "memory";
export type Selection = Record<string, { cpu: boolean; memory: boolean }>;

/**
 * Pure ranked-list presentation for VPA right-sizing rows (backlog #4, v1).
 * Selection state is lifted to the caller so it can drive the actual
 * dry-run/apply flow (which patches span potentially several rows grouped
 * by workload) — this component only renders rows and reports toggles.
 */
export function RightSizingTable({
  rows,
  selected,
  onToggle,
}: {
  rows: RightSizingRow[];
  selected: Selection;
  onToggle: (key: string, dim: Dim) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        <p>No right-sizing opportunities.</p>
        <p className="muted small">
          Shown here once a VPA's recommendation differs from a workload's current requests by at least 20% and 50m
          CPU / 64Mi memory.
        </p>
      </EmptyState>
    );
  }

  const selOf = (key: string) => selected[key] ?? { cpu: false, memory: false };
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => rowKey(r)}
      columns={[
        {
          key: "workload",
          header: "Workload",
          render: (r) => (
            <>
              <div className="mono strong small">{r.workloadName}</div>
              <div className="muted small">
                {r.workloadKind} · {r.ns}
              </div>
              {r.source === "vpa" ? (
                <Badge>VPA</Badge>
              ) : r.source === "prometheus" ? (
                <Badge>Kubebay (Prometheus, 7d)</Badge>
              ) : (
                <Badge>Kubebay (metrics-server)</Badge>
              )}
              {r.window && <div className="muted small">{r.window}</div>}
              {r.gitopsOwner && <Badge>{ownerLabel(r.gitopsOwner)}</Badge>}
              {r.hpaCpuConflict && <Badge tone="err">HPA scales this on CPU</Badge>}
            </>
          ),
        },
        { key: "container", header: "Container", className: "mono small", render: (r) => r.container },
        { key: "replicas", header: "Replicas", width: 70, className: "mono small", render: (r) => r.replicas },
        {
          key: "current",
          header: "Current",
          className: "mono small",
          render: (r) => `${formatCpuMillis(r.currentCpuMillis)} / ${formatMemBytes(r.currentMemBytes)}`,
        },
        {
          key: "target",
          header: "Target",
          className: "mono small",
          render: (r) => `${formatCpuMillis(r.targetCpuMillis)} / ${formatMemBytes(r.targetMemBytes)}`,
        },
        {
          key: "waste",
          header: "Fleet-wide waste",
          className: "mono small",
          render: (r) => `${formatCpuMillis(r.wastedCpuMillis)} / ${formatMemBytes(r.wastedMemBytes)}`,
        },
        {
          key: "apply",
          header: "Apply",
          width: 180,
          render: (r) => {
            const key = rowKey(r);
            const sel = selOf(key);
            return r.source !== "vpa" ? (
              <span className="muted small">view only</span>
            ) : (
              <>
                {r.cpuMaterial && (
                  <label className="ctl" style={{ cursor: r.hpaCpuConflict ? "not-allowed" : "pointer" }}>
                    <input
                      type="checkbox"
                      aria-label="cpu"
                      checked={sel.cpu}
                      disabled={r.hpaCpuConflict}
                      onChange={() => onToggle(key, "cpu")}
                    />
                    cpu
                  </label>
                )}
                {r.memMaterial && (
                  <label className="ctl" style={{ cursor: "pointer" }}>
                    <input type="checkbox" aria-label="memory" checked={sel.memory} onChange={() => onToggle(key, "memory")} />
                    memory
                  </label>
                )}
              </>
            );
          },
        },
      ]}
    />
  );
}
