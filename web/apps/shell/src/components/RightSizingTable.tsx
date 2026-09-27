import { Badge } from "@kubebay/ui";
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
      <div className="empty-state">
        <p>No right-sizing opportunities.</p>
        <p className="muted small">
          Shown here once a VPA's recommendation differs from a workload's current requests by at least 20% and 50m
          CPU / 64Mi memory.
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="kb-table">
        <thead>
          <tr>
            <th>Workload</th>
            <th>Container</th>
            <th style={{ width: 70 }}>Replicas</th>
            <th>Current</th>
            <th>Target</th>
            <th>Fleet-wide waste</th>
            <th style={{ width: 180 }}>Apply</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = rowKey(r);
            const sel = selected[key] ?? { cpu: false, memory: false };
            return (
              <tr key={key}>
                <td>
                  <div className="mono strong small">{r.workloadName}</div>
                  <div className="muted small">
                    {r.workloadKind} · {r.ns}
                  </div>
                  {r.source === "vpa" ? <Badge>VPA</Badge> : <Badge>Kubebay (metrics-server)</Badge>}
                  {r.window && <div className="muted small">{r.window}</div>}
                  {r.gitopsOwner && <Badge>{ownerLabel(r.gitopsOwner)}</Badge>}
                  {r.hpaCpuConflict && <Badge tone="err">HPA scales this on CPU</Badge>}
                </td>
                <td className="mono small">{r.container}</td>
                <td className="mono small">{r.replicas}</td>
                <td className="mono small">
                  {formatCpuMillis(r.currentCpuMillis)} / {formatMemBytes(r.currentMemBytes)}
                </td>
                <td className="mono small">
                  {formatCpuMillis(r.targetCpuMillis)} / {formatMemBytes(r.targetMemBytes)}
                </td>
                <td className="mono small">
                  {formatCpuMillis(r.wastedCpuMillis)} / {formatMemBytes(r.wastedMemBytes)}
                </td>
                <td>
                  {r.source !== "vpa" ? (
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
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
