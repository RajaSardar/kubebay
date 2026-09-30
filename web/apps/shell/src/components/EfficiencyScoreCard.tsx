import { Badge, Card, Row, Stack } from "@kubebay/ui";
import type { EfficiencyScore } from "../lib/efficiencyScore";

const GRADE: Record<NonNullable<EfficiencyScore["grade"]>, { label: string; tone: "ok" | "warn" | "err" }> = {
  good: { label: "Good", tone: "ok" },
  fair: { label: "Fair", tone: "warn" },
  poor: { label: "Poor", tone: "err" },
};

function toneOf(score: number): "ok" | "warn" | "err" {
  return score >= 75 ? "ok" : score >= 50 ? "warn" : "err";
}

/** Roadmap Tier 1 #5: the local efficiency score, shown above the Cost / Waste breakdown it's derived from. */
export function EfficiencyScoreCard({ efficiency }: { efficiency: EfficiencyScore }) {
  const grade = efficiency.grade ? GRADE[efficiency.grade] : null;
  return (
    <Card>
      <Row align="center" gap={2} style={{ marginBottom: 8 }}>
        <strong>Efficiency score</strong>
        {grade && <Badge tone={grade.tone}>{grade.label}</Badge>}
      </Row>

      {efficiency.score === null ? (
        <div className="muted small">No allocatable capacity to score.</div>
      ) : (
        <Stack gap={3}>
          <Row align="baseline" gap={2}>
            <span className="mono strong" style={{ fontSize: "var(--kb-text-xl)" }}>{efficiency.score}</span>
            <span className="muted small">/ 100</span>
          </Row>
          <Stack gap={2}>
            {efficiency.components.map((c) => (
              <Row key={c.key} align="center" gap={2} wrap>
                <Badge tone={toneOf(c.score)}>{c.score}</Badge>
                <strong className="small">{c.label}</strong>
                <span className="muted small">{c.detail}</span>
              </Row>
            ))}
          </Stack>
          {efficiency.missing.includes("optimization") && (
            <div className="muted small">
              Workload sizing isn't scored: no usage data yet (metrics-server or Prometheus). The other parts carry its weight.
            </div>
          )}
        </Stack>
      )}
    </Card>
  );
}
