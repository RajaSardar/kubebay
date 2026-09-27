import { useState } from "react";
import { Badge, Button, Card } from "@kubebay/ui";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";
import type { NodePoolRow } from "../lib/karpenter";
import { NodePoolEditor } from "./NodePoolEditor";

/**
 * Per-NodePool cards (backlog #3 P1): nodes provisioned, spot/on-demand
 * mix, pods/namespaces riding on it, and current resources against the
 * pool's own limits. Pure presentation — data fetching + the join live in
 * pages/Karpenter.tsx. Editing (backlog #3 P2) expands inline into
 * NodePoolEditor rather than a separate modal, keeping the impact banner
 * right next to the card it describes.
 */
export function NodePoolSummary({
  rows,
  cluster,
  gvr,
  nodes,
  pods,
  pdbs,
}: {
  rows: NodePoolRow[];
  cluster: string;
  gvr: string;
  nodes: Record<string, unknown>[];
  pods: Record<string, unknown>[];
  pdbs: Record<string, unknown>[];
}) {
  const [editing, setEditing] = useState<string | null>(null);

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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted small">
                {r.nodeCount} node{r.nodeCount === 1 ? "" : "s"} · {r.podCount} pods · {r.namespaceCount} namespaces
              </span>
              <Button variant="ghost" onClick={() => setEditing(editing === r.name ? null : r.name)}>
                {editing === r.name ? "Close" : "Edit"}
              </Button>
            </div>
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
          {editing === r.name && (
            <div style={{ marginTop: 12, height: 420, display: "flex", flexDirection: "column" }}>
              <Badge>editing NodePool</Badge>
              <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>
                <NodePoolEditor cluster={cluster} gvr={gvr} name={r.name} nodes={nodes} pods={pods} pdbs={pdbs} />
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
