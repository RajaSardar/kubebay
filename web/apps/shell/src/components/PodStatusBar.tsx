import { useId } from "react";
import { useNavigate } from "react-router-dom";
import { CellLink, Row, Stack } from "@kubebay/ui";
import type { PodStatusSegment } from "../lib/podStatusBar";

const FILL: Record<PodStatusSegment["tone"], string> = {
  ok: "var(--kb-status-ok)",
  warn: "var(--kb-status-warn)",
  err: "var(--kb-status-err)",
  pending: "var(--kb-status-pending)",
  terminated: "var(--kb-status-terminated)",
  terminating: "var(--kb-status-terminated)",
};

/**
 * Overview v2: every pod in one zero-based stacked bar, so "4 broken" reads as
 * 4 of 604. Each segment's word and count sit beside its colour and open the
 * Pods list filtered to it.
 */
export function PodStatusBar({ segments }: { segments: PodStatusSegment[] }) {
  const id = useId();
  const navigate = useNavigate();
  const total = segments.reduce((n, s) => n + s.count, 0);
  if (total === 0) return null;
  return (
    <section aria-labelledby={id}>
      <Stack gap={2}>
        <Row gap={2} align="center">
          <strong id={id}>Pods by status</strong>
          <span className="muted small">{`${total} pods`}</span>
        </Row>
        <Row gap={0} aria-hidden="true" style={{ height: 10, borderRadius: "var(--kb-radius-xs)", overflow: "hidden", background: "var(--kb-bg-inset)" }}>
          {segments.map((s) => (
            <div key={s.label} title={`${s.label}: ${s.count}`} style={{ width: `${(s.count / total) * 100}%`, background: FILL[s.tone] }} />
          ))}
        </Row>
        <Row gap={4} wrap>
          {segments.map((s) => (
            <CellLink
              key={s.label}
              href={s.to}
              onClick={(e) => {
                e.preventDefault();
                navigate(s.to);
              }}
            >
              <Row gap={2} align="center" as="span">
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "var(--kb-radius-2xs)", background: FILL[s.tone] }} />
                <span>{s.label}</span>{" "}
                <span className="mono">{s.count}</span>
              </Row>
            </CellLink>
          ))}
        </Row>
      </Stack>
    </section>
  );
}
