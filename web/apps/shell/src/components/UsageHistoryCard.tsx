import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ArmedButton, Badge, Button, Card, Row, Stack } from "@kubebay/ui";
import { historyApi, type HistoryStatus } from "../lib/api";

/**
 * Backlog #36: what Kubebay records for usage history, and the controls to
 * stop it or delete it. Consent is given by connecting to a cluster; this
 * card lists every cluster with a consent entry.
 */
export function UsageHistoryCard({ clusters }: { clusters: Record<string, boolean> }) {
  const qc = useQueryClient();
  const ids = Object.keys(clusters).sort();
  const statuses = useQueries({
    queries: ids.map((id) => ({ queryKey: ["history-status", id], queryFn: () => historyApi.status(id) })),
  });
  const byId = new Map<string, HistoryStatus | undefined>(ids.map((id, i) => [id, statuses[i]?.data]));
  const first = statuses.find((s) => s.data)?.data;

  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: ["history-status", id] });
    void qc.invalidateQueries({ queryKey: ["settings"] });
  };
  const setRecording = async (id: string, on: boolean) => {
    await historyApi.setRecording(id, on);
    refresh(id);
  };
  const erase = async (id: string) => {
    await historyApi.erase(id);
    refresh(id);
  };

  return (
    <Card style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Usage history</div>
      <Stack gap={3}>
        <div className="muted small">
          Kubebay records hourly namespace usage for clusters you connect to, only while the app is open, for 35 days.
          It stays on this computer.
        </div>
        {first && !first.available && <div className="small">History is unavailable: {first.reason}</div>}
        {ids.length === 0 ? (
          <div className="muted small">Nothing recorded yet. Connect to a cluster to start.</div>
        ) : (
          <Stack gap={2}>
            {ids.map((id) => {
              const st = byId.get(id);
              const on = st?.recording ?? clusters[id];
              return (
                <Row key={id} align="center" gap={2} wrap>
                  <span className="mono small strong">{id}</span>
                  {on ? <Badge tone="ok">recording</Badge> : <Badge>stopped</Badge>}
                  {st?.coverage && <span className="muted small">{st.coverage.label}</span>}
                  <Button variant="ghost" aria-label={`${on ? "Stop" : "Resume"} recording ${id}`} onClick={() => void setRecording(id, !on)}>
                    {on ? "Stop" : "Resume"}
                  </Button>
                  <ArmedButton label="Clear" confirmLabel="Delete history?" onGo={() => void erase(id)} />
                </Row>
              );
            })}
          </Stack>
        )}
        {first?.path && (
          <div className="muted small">
            Stored in <span className="mono">{first.path}</span>
          </div>
        )}
      </Stack>
    </Card>
  );
}
