import { Badge, Card, NsPill, Row, Stack } from "@kubebay/ui";
import type { SpotRiskFinding } from "../lib/spotRisk";

const REASON_LABEL: Record<SpotRiskFinding["reason"], string> = {
  "single-replica-on-spot": "Single replica on spot",
  "no-pdb-on-spot": "All replicas on spot, no PDB",
};

export function SpotRiskCard({ findings, spotNodeCount }: { findings: SpotRiskFinding[]; spotNodeCount: number }) {
  return (
    <Card>
      <Row align="center" gap={2} style={{ marginBottom: 8 }}>
        <strong>Spot disruption risk</strong>
        {spotNodeCount > 0 && <Badge tone={findings.length > 0 ? "err" : "ok"}>{findings.length}</Badge>}
      </Row>

      {spotNodeCount === 0 ? (
        <div className="muted small">No spot or preemptible nodes in this cluster.</div>
      ) : findings.length === 0 ? (
        <div className="muted small">Every workload on spot capacity can tolerate a reclaim.</div>
      ) : (
        <Stack gap={2}>
          {findings.map((f) => (
            <Row key={`${f.namespace}/${f.appLabel}`} align="center" gap={2} wrap>
              <Badge tone="err">{REASON_LABEL[f.reason]}</Badge>
              <NsPill>{f.namespace}</NsPill>
              <strong className="mono small">{f.appLabel}</strong>
              <span className="muted small">{f.podCount} pod{f.podCount === 1 ? "" : "s"}</span>
            </Row>
          ))}
        </Stack>
      )}
    </Card>
  );
}
