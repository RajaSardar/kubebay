import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, InlineBanner, Row, Stack } from "@kubebay/ui";
import { aiApi } from "../lib/aiInvestigate";

/**
 * Backlog 78: the per-user switch for "Investigate with AI". It only ever
 * runs the Claude Code you installed yourself; Kubebay keeps no key and calls
 * no other provider. Locked, with the reason, on a shared engine.
 */
export function AiSettingsCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status });
  const st = status.data;
  if (!st) return null;
  const locked = st.state === "locked";
  return (
    <Card id="ai-investigations" style={{ marginTop: 18 }}>
      <Stack gap={3}>
        <div className="rbac-section-title">AI investigations (Claude Code)</div>
        <div className="muted small">
          &quot;Investigate with AI&quot; on an issue, a pod or a workload runs Claude Code, the command-line tool you installed yourself, on this computer. It can read
          the issue&apos;s cluster through Kubebay&apos;s read-only tools and cannot change anything or see Secret values. Claude Code sends what it reads to
          Anthropic under your own account. Kubebay stores no API key, uses no other provider and runs no hosted service.
        </div>
        {locked && <InlineBanner tone="warn" flush>{st.reason}</InlineBanner>}
        <Row gap={2} align="center">
          <label className="ctl" style={{ cursor: locked ? "default" : "pointer" }}>
            <input
              type="checkbox"
              aria-label="Allow Investigate with AI"
              checked={st.enabled}
              disabled={locked}
              onChange={(e) => void aiApi.setEnabled(e.target.checked).then((next) => qc.setQueryData(["ai-status"], next))}
            />
            <span className="small strong">Allow Investigate with AI</span>
          </label>
        </Row>
        {!locked && st.state === "no-claude" && <div className="small muted">{st.installHelp}</div>}
        {!locked && st.claudePath && <div className="small muted">Found Claude Code at {st.claudePath}.</div>}
      </Stack>
    </Card>
  );
}
