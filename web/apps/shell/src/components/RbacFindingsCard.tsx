import { useState } from "react";
import { Badge, Button, Card, Row, Stack } from "@kubebay/ui";
import type { RBACFinding } from "../lib/api";
import { isSystemFinding, findingQuery, type FindingQuery } from "../lib/rbacFindings";

/**
 * Findings from the engine's static RBAC advisor (AnalyzeRBAC) — real
 * subjects holding a risky permission via a real binding, not just a risky
 * role definition sitting unused. Clicking a finding that carries a query
 * hint pre-fills the "Who can …" card above so findings and the explorer
 * become one loop, instead of two disconnected views.
 */
export function RbacFindingsCard({
  findings,
  onQuery,
}: {
  findings: RBACFinding[];
  onQuery: (q: FindingQuery) => void;
}) {
  const [hideSystem, setHideSystem] = useState(true);

  const visible = findings
    .filter((f) => !hideSystem || !isSystemFinding(f))
    .slice()
    .sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === "high" ? -1 : 1;
    });

  const hiddenCount = findings.length - visible.length;

  return (
    <Card style={{ marginBottom: 16 }}>
      <Row align="center" gap={2} className="rbac-section-title">
        Findings
        <Badge tone={visible.length > 0 ? "err" : "ok"}>{visible.length}</Badge>
      </Row>
      <label className="ctl" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={hideSystem} onChange={(e) => setHideSystem(e.target.checked)} />
        hide system:* roles
      </label>

      {visible.length === 0 ? (
        <div className="muted small" style={{ marginTop: 10 }}>
          No findings{hiddenCount > 0 ? ` (${hiddenCount} hidden by the system:* filter)` : ""}.
        </div>
      ) : (
        <Stack gap={2} className="rbac-findings-list" style={{ marginTop: 10 }}>
          {visible.map((f, i) => {
            const q = findingQuery(f);
            return (
              <div key={i} className="rbac-finding" style={{ borderBottom: "1px solid var(--kb-border-subtle)", paddingBottom: 10 }}>
                <Row align="center" gap={2} wrap>
                  <Badge tone={f.severity === "high" ? "err" : undefined}>{f.severity}</Badge>
                  <span className="small strong">{f.title}</span>
                </Row>
                <div className="small muted">
                  {f.subject} via <span className="mono">{f.roleRef}</span>
                </div>
                <div className="small">{f.why}</div>
                {f.suggestion && <div className="small muted mono">{f.suggestion}</div>}
                {q && (
                  <Button variant="ghost" style={{ marginTop: 4 }} onClick={() => onQuery(q)}>
                    Show who else has this
                  </Button>
                )}
              </div>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}
