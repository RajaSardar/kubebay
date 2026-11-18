import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, InlineBanner, Row, Stack, TextField } from "@kubebay/ui";
import { warmPolicyApi } from "../lib/api";

const MAX_CLUSTERS = 50;
const MAX_IDLE_MINUTES = 24 * 60;

function wholeNumber(text: string, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n <= max ? n : null;
}

/**
 * Backlog 37: how many connected clusters keep live streams, and how long an
 * unviewed one stays warm. The engine applies a saved value at once; the
 * active cluster and pinned ones are never put to sleep.
 */
export function WarmClustersCard() {
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ["warm-policy"], queryFn: warmPolicyApi.get });
  const p = policy.data;
  const [clusters, setClusters] = useState("");
  const [idle, setIdle] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!p) return;
    setClusters(String(p.clusters));
    setIdle(String(p.idleMinutes));
  }, [p?.clusters, p?.idleMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return null;
  const off = !p.available;

  async function save() {
    const c = wholeNumber(clusters, MAX_CLUSTERS);
    const i = wholeNumber(idle, MAX_IDLE_MINUTES);
    if (c === null) return setMessage({ text: `Warm clusters must be a whole number, 0 to ${MAX_CLUSTERS}.`, error: true });
    if (i === null) return setMessage({ text: `Idle minutes must be a whole number, 0 to ${MAX_IDLE_MINUTES}.`, error: true });
    try {
      qc.setQueryData(["warm-policy"], await warmPolicyApi.save({ clusters: c, idleMinutes: i }));
      setMessage({ text: "Saved. The engine is using it now.", error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  return (
    <Card id="warm-clusters" style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Warm clusters</div>
      <Stack gap={3}>
        <p className="small muted" style={{ margin: 0 }}>
          Kubebay keeps this many connected clusters streaming. Opening one more puts the least recently viewed one to
          sleep, and a cluster nobody viewed for the idle time sleeps too. Sleeping clusters free their memory and
          reconnect when you open them. The cluster you are viewing and your pinned clusters are never put to sleep.
          0 means no limit for clusters, and never for idle time.
        </p>
        {off && (
          <InlineBanner tone="warn" flush>
            {p.reason}
          </InlineBanner>
        )}
        <Row gap={3} align="end" wrap>
          <TextField
            aria-label="Warm clusters"
            type="number"
            min={0}
            max={MAX_CLUSTERS}
            value={clusters}
            disabled={off}
            onChange={(e) => setClusters(e.target.value)}
          />
          <TextField
            aria-label="Idle minutes"
            type="number"
            min={0}
            max={MAX_IDLE_MINUTES}
            value={idle}
            disabled={off}
            onChange={(e) => setIdle(e.target.value)}
          />
          <Button disabled={off} onClick={() => void save()}>
            Save
          </Button>
          <Button
            variant="ghost"
            disabled={off}
            onClick={() => {
              setClusters(String(p.defaultClusters));
              setIdle(String(p.defaultIdleMinutes));
              setMessage(null);
            }}
          >
            Reset to defaults
          </Button>
        </Row>
        {message && <p className={`small ${message.error ? "error-text" : "muted"}`} style={{ margin: 0 }}>{message.text}</p>}
      </Stack>
    </Card>
  );
}
