import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, InlineBanner, Row, Stack, StatusPill } from "@kubebay/ui";
import { api } from "../lib/api";
import { ResourceLink } from "./ResourceLink";
import { ProdApplyModal } from "./ProdApplyModal";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";
import { extSlug } from "../lib/resources";
import {
  ROLLOUT_ACTION_LABELS,
  availableRolloutActions,
  describeRollout,
  rolloutActionRequest,
  type RolloutAction,
  type RolloutRevision,
} from "../lib/rollouts";

function Revision({ label, rev }: { label: string; rev: RolloutRevision | null }) {
  if (!rev) return null;
  return (
    <div className="small">
      <span className="muted">{label} </span>
      <span className="mono">{rev.name}</span>
      <span className="muted">{` · rev ${rev.revision || "?"} · `}</span>
      <span className="mono">{rev.images.join(", ")}</span>
    </div>
  );
}

/**
 * The Argo Rollouts dashboard: one card per Rollout with its strategy, phase,
 * step, traffic split, replica counts, stable and canary revisions, pause
 * state and AnalysisRuns, plus Promote / Abort / Retry / Restart. Actions go
 * through the same impersonated, audited YAML apply path as every other edit
 * and ask first on a cluster whose name looks like production.
 */
export function RolloutsDashboard({
  cluster,
  rolloutGvr,
  rollouts,
  replicaSets,
  analysisRuns,
}: {
  cluster: string;
  rolloutGvr?: string;
  rollouts: Record<string, unknown>[];
  replicaSets: Record<string, unknown>[];
  analysisRuns: Record<string, unknown>[];
}) {
  const prod = useClusterLooksProduction(cluster);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ ns: string; name: string; action: RolloutAction } | null>(null);

  const rows = useMemo(
    () => rollouts.map((ro) => ({ ro, d: describeRollout(ro, replicaSets, analysisRuns) })),
    [rollouts, replicaSets, analysisRuns],
  );

  async function run(ns: string, name: string, action: RolloutAction) {
    if (!rolloutGvr) return;
    setBusy(true);
    setError(null);
    try {
      await api.applyYaml(rolloutActionRequest({ cluster, gvr: rolloutGvr, ns, name }, action));
    } catch (e) {
      setError(`Couldn't ${ROLLOUT_ACTION_LABELS[action].toLowerCase()} ${name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function request(ns: string, name: string, action: RolloutAction) {
    if (prod.production) setConfirming({ ns, name, action });
    else void run(ns, name, action);
  }

  if (rows.length === 0) {
    return (
      <EmptyState>
        <p>No Rollouts found on this cluster.</p>
      </EmptyState>
    );
  }

  return (
    <Stack gap={2}>
      {error && <InlineBanner flush>{error}</InlineBanner>}
      {rows.map(({ ro, d }) => (
        <Card key={`${d.ns}/${d.name}`}>
          <Row align="center" gap={2} wrap>
            {rolloutGvr ? (
              <ResourceLink kind={`ext--${extSlug(rolloutGvr)}`} ns={d.ns} name={d.name}>
                <span className="mono strong small">{d.name}</span>
              </ResourceLink>
            ) : (
              <span className="mono strong small">{d.name}</span>
            )}
            <span className="muted small">{d.ns}</span>
            <StatusPill tone={d.tone}>{d.phase}</StatusPill>
            {d.strategy !== "unknown" && <Badge>{d.strategy === "blueGreen" ? "blueGreen" : "canary"}</Badge>}
            {rolloutGvr &&
              availableRolloutActions(ro).map((a) => (
                <Button key={a} variant="ghost" disabled={busy} onClick={() => request(d.ns, d.name, a)}>
                  {ROLLOUT_ACTION_LABELS[a]}
                </Button>
              ))}
          </Row>

          {(d.paused || d.message) && (
            <Row gap={2} align="center" wrap style={{ marginTop: 8 }}>
              {d.paused && <span className="small">Paused:</span>}
              {(d.paused ? d.pauseMessage : d.message) && <span className="small">{d.paused ? d.pauseMessage : d.message}</span>}
            </Row>
          )}

          <Row gap={3} wrap style={{ marginTop: 8 }}>
            {d.step && <span className="small">{`step ${d.step.current} of ${d.step.total}`}</span>}
            {d.weights && (
              <>
                <span className="small">{`${d.weights.canary}% canary`}</span>
                <span className="small">{`${d.weights.stable}% stable`}</span>
              </>
            )}
            <span className="muted small">
              {`desired ${d.replicas.desired} / updated ${d.replicas.updated} / ready ${d.replicas.ready} / available ${d.replicas.available}`}
            </span>
          </Row>

          <div style={{ marginTop: 8 }}>
            <Revision label="stable revision" rev={d.stable} />
            <Revision label="canary revision" rev={d.canary} />
          </div>

          {d.analysisRuns.length > 0 && (
            <Row gap={2} align="center" wrap style={{ marginTop: 8 }}>
              <span className="muted small">Analysis</span>
              {d.analysisRuns.map((a) => (
                <Row key={a.name} gap={1} align="center">
                  <span className="mono small">{a.name}</span>
                  <StatusPill tone={a.tone}>{a.phase}</StatusPill>
                </Row>
              ))}
            </Row>
          )}
        </Card>
      ))}

      {confirming && (
        <ProdApplyModal
          context={prod.context}
          target={`${ROLLOUT_ACTION_LABELS[confirming.action].toLowerCase()} on rollout ${confirming.name}`}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const c = confirming;
            setConfirming(null);
            void run(c.ns, c.name, c.action);
          }}
        />
      )}
    </Stack>
  );
}
