import { Card } from "@kubebay/ui";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";
import type { NodePoolRow } from "../lib/karpenter";

/**
 * Per-NodePool cards (backlog #3 P1): nodes provisioned, spot/on-demand
 * mix, pods/namespaces riding on it, and current resources against the
 * pool's own limits. Pure presentation — data fetching + the join live in
 * pages/Karpenter.tsx.
 */
export function NodePoolSummary({ rows }: { rows: NodePoolRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>No NodePools found.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r) => (
        <Card key={r.name}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span className="mono strong">{r.name}</span>
            <span className="muted small">
              {r.nodeCount} node{r.nodeCount === 1 ? "" : "s"} · {r.podCount} pods · {r.namespaceCount} namespaces
            </span>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {r.spotCount} spot / {r.onDemandCount} on-demand
          </div>
          <div className="mono small" style={{ marginTop: 6 }}>
            {r.usedCpuMillis !== undefined ? formatCpuMillis(r.usedCpuMillis) : "–"} /{" "}
            {r.limitCpuMillis !== undefined ? formatCpuMillis(r.limitCpuMillis) : "no limit"} cpu ·{" "}
            {r.usedMemBytes !== undefined ? formatMemBytes(r.usedMemBytes) : "–"} /{" "}
            {r.limitMemBytes !== undefined ? formatMemBytes(r.limitMemBytes) : "no limit"} memory
          </div>
        </Card>
      ))}
    </div>
  );
}
