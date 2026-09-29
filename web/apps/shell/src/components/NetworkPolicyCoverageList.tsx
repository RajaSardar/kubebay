import { Badge, Card, EmptyState, Row, Stack } from "@kubebay/ui";
import { NsPill } from "@kubebay/ui";
import type { CoverageGap } from "../lib/networkPolicyCoverage";

const REASON_LABEL: Record<CoverageGap["reason"], string> = {
  "no-policy-in-namespace": "No policy in namespace",
  "not-selected-by-any-policy": "Not covered by any policy",
};

/**
 * Backlog #26: pure-rendering half of the NetworkPolicy Coverage Gap
 * Detector. Deliberately a flat list, not the connectivity matrix
 * NetworkPolicy.tsx already renders -- the value here is turning that
 * matrix's own "open" signal into something scannable without reading an
 * N×N grid, same shape as SPOF Radar's list.
 */
export function NetworkPolicyCoverageList({ gaps }: { gaps: CoverageGap[] }) {
  if (gaps.length === 0) {
    return (
      <EmptyState>
        <p>Every workload has NetworkPolicy coverage.</p>
      </EmptyState>
    );
  }

  return (
    <Stack as="ul" gap={2} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {gaps.map((g) => (
        <li key={`${g.namespace}/${g.appLabel}`}>
          <Card>
            <Row align="center" gap={2} wrap>
              <Badge tone="err">{REASON_LABEL[g.reason]}</Badge>
              <NsPill>{g.namespace}</NsPill>
              <strong className="mono small">{g.appLabel}</strong>
              <span className="muted small">{g.podCount} pod{g.podCount === 1 ? "" : "s"}</span>
            </Row>
          </Card>
        </li>
      ))}
    </Stack>
  );
}
