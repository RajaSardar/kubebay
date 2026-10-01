import { Badge, Card, DataTable, Row, Stack, type BadgeTone } from "@kubebay/ui";
import type { ConsolidationBlocker, ConsolidationResult, NodeConsolidation } from "../lib/consolidation";
import { formatCpuMillis, formatMemBytes } from "../lib/rightsizing";

const VERDICT: Record<NodeConsolidation["outcome"], { label: string; tone?: BadgeTone }> = {
  drainable: { label: "fits elsewhere", tone: "ok" },
  downtime: { label: "drain causes downtime", tone: "warn" },
  blocked: { label: "blocked", tone: "err" },
  skipped: { label: "skipped" },
};

function blockerText(b: ConsolidationBlocker): string {
  const where = `(${b.ns}/${b.pod})`;
  switch (b.kind) {
    case "pdb":
      return `PDB ${b.pdb} allows no disruptions ${where}`;
    case "bare-pod":
      return `no controller, a drain deletes it ${where}`;
    case "constrained":
      return `pod affinity or host port not simulated ${where}`;
    default:
      return `no room elsewhere ${where}`;
  }
}

function why(n: NodeConsolidation): string {
  if (n.outcome === "skipped") return n.skipReason ?? "";
  const parts = [
    ...n.blockers.map(blockerText),
    ...n.spof.map((s) => `single replica, no PDB: ${s.ns}/${s.workloadKind}/${s.name}`),
  ];
  return parts.join("; ") || "—";
}

/**
 * Intelligence roadmap Tier 2 #15: which nodes could be drained with every
 * pod fitting elsewhere by requests, gated by SPOF Radar. Read-only.
 */
export function ConsolidationCard({ result }: { result: ConsolidationResult }) {
  const considered = result.nodes.filter((n) => n.outcome !== "skipped").length;
  const k = result.drainable.length;
  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>Node consolidation</strong>
          <Badge>read-only</Badge>
          <span className="small">
            {k > 0
              ? `${k} of ${considered} nodes could be drained one after another, every pod fitting elsewhere by requests.`
              : "No node can be drained right now without a blocker or downtime."}
          </span>
        </Row>
        <div className="muted small">
          Simulated by requests, not usage, honouring node selectors, required node affinity and taints. Each row is that
          node alone; the count above drains them in sequence, so it can be lower. Kubebay never cordons or drains.
        </div>
        <DataTable
          rows={result.nodes}
          rowKey={(n) => n.node}
          columns={[
            { key: "node", header: "Node", className: "mono small", render: (n) => n.node },
            {
              key: "req",
              header: "Requested / allocatable",
              className: "mono small",
              render: (n) =>
                `${formatCpuMillis(n.requestedCpuMillis)} / ${formatCpuMillis(n.allocatableCpuMillis)} · ${formatMemBytes(n.requestedMemBytes)} / ${formatMemBytes(n.allocatableMemBytes)}`,
            },
            { key: "pods", header: "Pods to move", className: "mono small", render: (n) => (n.outcome === "skipped" ? "—" : n.podsToMove) },
            {
              key: "verdict",
              header: "Verdict",
              render: (n) => <Badge tone={VERDICT[n.outcome].tone}>{VERDICT[n.outcome].label}</Badge>,
            },
            { key: "why", header: "Why", className: "small", render: (n) => why(n) },
          ]}
        />
      </Stack>
    </Card>
  );
}
