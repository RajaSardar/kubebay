import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArmedButton, Card, InlineBanner, Row, Select, Stack } from "@kubebay/ui";
import { timelineApi } from "../lib/api";
import { RETENTION_CHOICES } from "../lib/timeline";

function mb(n: number): string {
  return `${(n / (1 << 20)).toFixed(1)} MB`;
}

/**
 * Backlog 82: the desktop change timeline's retention, size and a clear
 * button. On a shared engine the engine answers 403 with the reason and the
 * controls are replaced by it.
 */
export function ChangeTimelineCard() {
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ["timeline-status"], queryFn: timelineApi.status, retry: false });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["timeline-status"] });

  return (
    <Card style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Change timeline</div>
      <Stack gap={3}>
        <div className="muted small">
          Kubebay can keep a local record of object changes and events it sees while pages are open, with the field manager and the field
          paths that changed, never values and never Secrets. It stays in one file on this computer, which is not encrypted.
        </div>
        {st.isError && <InlineBanner flush>{String(st.error instanceof Error ? st.error.message : st.error)}</InlineBanner>}
        {st.data && (
          <>
            <Row align="center" gap={2} wrap>
              <label htmlFor="timeline-retention" className="small">
                Keep changes for
              </label>
              <Select
                id="timeline-retention"
                value={st.data.retentionDays}
                onChange={async (e) => {
                  await timelineApi.setRetention(Number(e.target.value));
                  refresh();
                }}
              >
                {RETENTION_CHOICES.map((c) => (
                  <option key={c.days} value={c.days}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <ArmedButton
                label="Clear"
                confirmLabel="Delete all recorded changes?"
                onGo={async () => {
                  await timelineApi.clear();
                  refresh();
                }}
              />
            </Row>
            {st.data.enabled ? (
              <div className="muted small">
                {st.data.rows.toLocaleString()} changes, {mb(st.data.dbBytes)} of {mb(st.data.capBytes)} allowed; the oldest are removed first.
              </div>
            ) : (
              <div className="muted small">{st.data.error ? `Unavailable: ${st.data.error}` : "Off: nothing is recorded and no file is kept."}</div>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
