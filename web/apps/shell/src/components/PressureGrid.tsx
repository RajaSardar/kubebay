import type { PressureGrid as PressureGridData } from "../lib/pressure";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";

const CELL = 26;
const GAP = 2;
const ROW_LABEL_W = 140;
const COL_LABEL_H = 90;

/**
 * Hand-rolled SVG rect grid — following the same zero-dependency approach as
 * LineChart.tsx, since a charting library is unaffordable for one grid.
 * Intensity is requests (or usage, once a metrics-server sample exists) as a
 * fraction of that column's node allocatable; BestEffort pods (no requests
 * at all) get a distinct hatch so they're never silently invisible in a
 * requests-based view.
 */
export function PressureGrid({ grid }: { grid: PressureGridData }) {
  if (grid.namespaces.length === 0 || grid.nodes.length === 0) {
    return (
      <div className="empty-state">
        <p>No pods scheduled — nothing to plot.</p>
      </div>
    );
  }

  const cellByKey = new Map(grid.cells.map((c) => [`${c.ns}|${c.node}`, c]));
  const W = ROW_LABEL_W + grid.nodes.length * (CELL + GAP);
  const H = COL_LABEL_H + grid.namespaces.length * (CELL + GAP);

  function intensity(ns: string, node: string): number {
    const cell = cellByKey.get(`${ns}|${node}`);
    if (!cell) return 0;
    const alloc = grid.nodeAllocatable[node];
    if (!alloc || (alloc.cpuMillis === 0 && alloc.memBytes === 0)) return 0;
    const cpuFrac = alloc.cpuMillis > 0 ? (grid.hasUsageData ? cell.usedCpuMillis : cell.requestedCpuMillis) / alloc.cpuMillis : 0;
    const memFrac = alloc.memBytes > 0 ? (grid.hasUsageData ? cell.usedMemBytes : cell.requestedMemBytes) / alloc.memBytes : 0;
    return Math.min(Math.max(cpuFrac, memFrac), 1);
  }

  return (
    <div>
      {!grid.hasUsageData && (
        <div className="muted small" style={{ marginBottom: 8 }}>
          Requests-only view — no metrics-server sample available, so intensity reflects requested capacity, not
          actual usage.
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Namespace by node resource pressure">
          {grid.nodes.map((node, ci) => (
            <text
              key={`col-${node}`}
              x={ROW_LABEL_W + ci * (CELL + GAP) + CELL / 2}
              y={COL_LABEL_H - 8}
              fontSize={10}
              fill="var(--kb-fg-muted)"
              textAnchor="start"
              transform={`rotate(-45, ${ROW_LABEL_W + ci * (CELL + GAP) + CELL / 2}, ${COL_LABEL_H - 8})`}
            >
              {node}
            </text>
          ))}
          {grid.namespaces.map((ns, ri) => (
            <g key={`row-${ns}`}>
              <text x={0} y={COL_LABEL_H + ri * (CELL + GAP) + CELL / 2 + 4} fontSize={11} fill="var(--kb-fg-default)">
                {ns}
              </text>
              {grid.nodes.map((node, ci) => {
                const cell = cellByKey.get(`${ns}|${node}`);
                const frac = intensity(ns, node);
                const x = ROW_LABEL_W + ci * (CELL + GAP);
                const y = COL_LABEL_H + ri * (CELL + GAP);
                const bestEffort = (cell?.bestEffortCount ?? 0) > 0;
                return (
                  <g key={`${ns}|${node}`} data-besteffort={bestEffort ? "true" : undefined}>
                    <rect
                      x={x}
                      y={y}
                      width={CELL}
                      height={CELL}
                      rx={3}
                      fill={frac > 0 ? `color-mix(in srgb, var(--kb-status-warn, #f59e0b) ${Math.round(frac * 100)}%, var(--kb-bg-inset))` : "var(--kb-bg-inset)"}
                      stroke={bestEffort ? "var(--kb-status-err, #ef4444)" : "var(--kb-border-subtle)"}
                      strokeWidth={bestEffort ? 1.5 : 1}
                      strokeDasharray={bestEffort ? "3 2" : undefined}
                    >
                      <title>
                        {ns} on {node}: {cell ? `${formatCpuMillis(cell.requestedCpuMillis)} / ${formatMemBytes(cell.requestedMemBytes)} requested, ${cell.podCount} pod(s)${bestEffort ? `, ${cell.bestEffortCount} BestEffort` : ""}` : "no pods"}
                      </title>
                    </rect>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      {(grid.otherNamespacesCount > 0 || grid.otherNodesCount > 0) && (
        <div className="muted small" style={{ marginTop: 6 }}>
          {grid.otherNamespacesCount > 0 && <span>{grid.otherNamespacesLabel} namespace(s) rolled up. </span>}
          {grid.otherNodesCount > 0 && <span>{grid.otherNodesLabel} node(s) rolled up.</span>}
        </div>
      )}
    </div>
  );
}
