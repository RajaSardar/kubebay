import { useId } from "react";
import { useNavigate } from "react-router-dom";
import { CellLink, Row, SegmentedControl, Stack } from "@kubebay/ui";
import { fmtBytes, fmtCpu } from "../lib/format";
import type { NamespaceRank } from "../lib/namespaceRanking";

export type NamespaceRankBy = "problems" | "requests";

function facts(r: NamespaceRank, by: NamespaceRankBy): string {
  return by === "requests"
    ? `${fmtCpu(r.cpuRequested)} · ${fmtBytes(r.memRequested)} requested · ${r.cpuShare}% of CPU requested`
    : `${r.broken} broken · ${r.warnings} warnings · ${r.pods} pods`;
}

/**
 * Overview v2, below the fold: the namespaces that most need a look, as
 * zero-based bars — by broken pods then warnings (which team to ping), or by
 * CPU requested (who holds the room). Each name opens its pods.
 */
export function NamespacesRanked({ rows, by, onBy }: { rows: NamespaceRank[]; by: NamespaceRankBy; onBy: (by: NamespaceRankBy) => void }) {
  const id = useId();
  const navigate = useNavigate();
  if (rows.length < 2) return null;
  const value = (r: NamespaceRank) => (by === "requests" ? r.cpuRequested : r.broken + r.warnings);
  const max = Math.max(1, ...rows.map(value));
  const fill = (r: NamespaceRank) =>
    by === "requests" ? "var(--kb-accent)" : r.broken > 0 ? "var(--kb-status-err)" : r.warnings > 0 ? "var(--kb-status-warn)" : "var(--kb-status-ok)";
  return (
    <section aria-labelledby={id}>
      <Stack gap={3}>
        <Row gap={3} align="center" wrap>
          <strong id={id}>Namespaces</strong>
          <SegmentedControl
            label="Rank namespaces by"
            options={[
              { value: "problems", label: "Problems" },
              { value: "requests", label: "Requests" },
            ]}
            value={by}
            onChange={onBy}
          />
        </Row>
        <Stack gap={2}>
          {rows.map((r) => {
            const to = `/workloads?${new URLSearchParams({ q: `ns:${r.namespace}` }).toString()}`;
            return (
              <Stack key={r.namespace} gap={1}>
                <Row gap={3} align="baseline" wrap>
                  <span className="mono">
                    <CellLink
                      href={to}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(to);
                      }}
                    >
                      {r.namespace}
                    </CellLink>
                  </span>
                  <span className="muted small">{facts(r, by)}</span>
                </Row>
                <div aria-hidden="true" style={{ height: 6, borderRadius: "var(--kb-radius-xs)", background: "var(--kb-bg-inset)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(value(r) / max) * 100}%`, background: fill(r) }} />
                </div>
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </section>
  );
}
