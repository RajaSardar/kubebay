import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, InlineBanner, Modal, Row, Stack, StatusPill, TextField } from "@kubebay/ui";
import { api } from "../lib/api";
import { ResourceLink } from "./ResourceLink";
import { explainScaledObject, hpaConflictsWithScaledObject, pauseScaledObjectRequest } from "../lib/keda";
import type { OrphanedTriggerAuth } from "../lib/keda";
import { extSlug, slugForKind } from "../lib/resources";

type Filter = "all" | "conflicts" | "scale-to-zero";

/**
 * Cluster-wide ScaledObject inventory -- the fleet-wide view the
 * KEDA-nav-placement research identified as missing: the per-workload
 * Autoscaling tab (AutoscalingSummary) can only ever show one workload's
 * own ScaledObjects, so "which ScaledObjects in this cluster conflict with
 * an HPA" or "which are scale-to-zero" had no single screen to answer from.
 * This is a new, separate component rather than a reuse of
 * AutoscalingSummary because that one bundles HPA/VPA cards inline per
 * workload, a shape that doesn't fit a flat cross-namespace list.
 */
export function KedaInventory({
  cluster,
  scaledObjects,
  hpas,
  orphanedTriggerAuths,
  scaledObjectGvr,
  triggerAuthGvr,
  clusterTriggerAuthGvr,
}: {
  /** The cluster the ScaledObjects live on; with scaledObjectGvr it enables Pause / Unpause. */
  cluster?: string;
  scaledObjects: Record<string, unknown>[];
  hpas: Record<string, unknown>[];
  orphanedTriggerAuths: OrphanedTriggerAuth[];
  /** GVRs from CRD detection, needed to build a correct ext--<group>--<version>--<resource> link slug. Omit to render plain text instead of a link. */
  scaledObjectGvr?: string;
  triggerAuthGvr?: string;
  clusterTriggerAuthGvr?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [pausing, setPausing] = useState<{ ns: string; name: string; replicas: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPause = !!cluster && !!scaledObjectGvr;

  async function run(ns: string, name: string, replicas: number | null) {
    if (!cluster || !scaledObjectGvr) return;
    setBusy(true);
    setError(null);
    try {
      await api.applyYaml(pauseScaledObjectRequest({ cluster, gvr: scaledObjectGvr, ns, name }, replicas));
      setPausing(null);
    } catch (e) {
      setError(`Couldn't ${replicas === null ? "unpause" : "pause"} ${name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  const pauseCount = pausing ? Number(pausing.replicas) : NaN;
  const pauseValid = pausing !== null && pausing.replicas.trim() !== "" && Number.isInteger(pauseCount) && pauseCount >= 0;

  const explained = useMemo(
    () => scaledObjects.map((so) => ({ so, explain: explainScaledObject(so), conflict: hpaConflictsWithScaledObject(so, hpas) })),
    [scaledObjects, hpas],
  );

  const filtered = explained.filter((e) => {
    if (filter === "conflicts") return e.conflict;
    if (filter === "scale-to-zero") return e.explain.minReplicaZero;
    return true;
  });

  return (
    <Stack gap={3}>
      {scaledObjects.length > 0 && (
        <Row gap={2}>
          <Button variant={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")}>
            All ({scaledObjects.length})
          </Button>
          <Button variant={filter === "conflicts" ? "primary" : "ghost"} onClick={() => setFilter("conflicts")}>
            Conflicts ({explained.filter((e) => e.conflict).length})
          </Button>
          <Button variant={filter === "scale-to-zero" ? "primary" : "ghost"} onClick={() => setFilter("scale-to-zero")}>
            Scale-to-zero ({explained.filter((e) => e.explain.minReplicaZero).length})
          </Button>
        </Row>
      )}

      {error && <InlineBanner flush>{error}</InlineBanner>}

      {scaledObjects.length === 0 ? (
        <EmptyState>
          <p>No ScaledObjects found on this cluster.</p>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>
          <p>No ScaledObjects match this filter.</p>
        </EmptyState>
      ) : (
        <Stack gap={2}>
          {filtered.map(({ explain, conflict }) => (
            <Card key={`${explain.ns}/${explain.name}`}>
              <Row align="center" gap={2} wrap>
                {scaledObjectGvr ? (
                  <ResourceLink kind={`ext--${extSlug(scaledObjectGvr)}`} ns={explain.ns} name={explain.name}>
                    <span className="mono strong small">{explain.name}</span>
                  </ResourceLink>
                ) : (
                  <span className="mono strong small">{explain.name}</span>
                )}
                <span className="muted small">{explain.ns}</span>
                {explain.paused ? <StatusPill tone="warn">Paused</StatusPill> : <StatusPill tone="ok">Active</StatusPill>}
                {canPause &&
                  (explain.paused ? (
                    <Button variant="ghost" disabled={busy} onClick={() => run(explain.ns, explain.name, null)}>
                      Unpause
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setPausing({ ns: explain.ns, name: explain.name, replicas: String(explain.currentReplicas ?? explain.minReplicas) })}
                    >
                      Pause
                    </Button>
                  ))}
              </Row>
              <div className="small" style={{ marginTop: 8 }}>
                {explain.summary} — target{" "}
                {(() => {
                  const targetSlug = slugForKind(explain.targetKind);
                  return targetSlug ? (
                    <ResourceLink kind={targetSlug} ns={explain.ns} name={explain.targetName}>
                      {explain.targetName}
                    </ResourceLink>
                  ) : (
                    <span className="mono">{explain.targetName}</span>
                  );
                })()}
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                min {explain.minReplicas} / max {explain.maxReplicas}
                {explain.currentReplicas !== undefined ? ` / current ${explain.currentReplicas}` : ""}
              </div>
              {explain.minReplicaZero && (
                <div className="small" style={{ marginTop: 8, color: "var(--kb-status-warn)" }}>
                  ⚠ scale-to-zero (minReplicaCount: 0) — the workload can go idle between triggers.
                </div>
              )}
              {conflict && (
                <InlineBanner flush style={{ marginTop: 8 }}>
                  Conflict: an HPA also targets {explain.targetKind.toLowerCase()} "{explain.targetName}" — dual ownership
                  causes replica flapping. Remove one.
                </InlineBanner>
              )}
            </Card>
          ))}
        </Stack>
      )}

      {pausing && (
        <Modal label={`Pause ${pausing.name}`} title={`Pause ${pausing.name}`} onClose={() => setPausing(null)} placement="center">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pauseValid) void run(pausing.ns, pausing.name, pauseCount);
            }}
          >
            <Stack gap={3}>
              <p className="small">
                KEDA stops autoscaling this ScaledObject and holds its workload at this many replicas until you unpause. Use 0 to scale it down.
              </p>
              <label className="small" htmlFor="keda-pause-replicas">
                Replicas to hold
              </label>
              <TextField
                id="keda-pause-replicas"
                type="number"
                min={0}
                step={1}
                value={pausing.replicas}
                onChange={(e) => setPausing({ ...pausing, replicas: e.target.value })}
              />
              <Row gap={2}>
                <Button type="submit" variant="primary" disabled={!pauseValid || busy}>
                  Pause autoscaling
                </Button>
                <Button type="button" variant="ghost" onClick={() => setPausing(null)}>
                  Cancel
                </Button>
              </Row>
            </Stack>
          </form>
        </Modal>
      )}

      {orphanedTriggerAuths.length > 0 && (
        <div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Orphaned trigger authentications — no ScaledObject references these
          </div>
          <Stack gap={2}>
            {orphanedTriggerAuths.map((ta) => {
              const gvr = ta.scoped ? triggerAuthGvr : clusterTriggerAuthGvr;
              return (
                <Card key={`${ta.ns}/${ta.name}`}>
                  <Row align="center" gap={2}>
                    <Badge tone="err">orphan</Badge>
                    {gvr ? (
                      <ResourceLink kind={`ext--${extSlug(gvr)}`} ns={ta.ns} name={ta.name}>
                        <span className="mono strong small">{ta.name}</span>
                      </ResourceLink>
                    ) : (
                      <span className="mono strong small">{ta.name}</span>
                    )}
                    {ta.scoped && <span className="muted small">{ta.ns}</span>}
                  </Row>
                </Card>
              );
            })}
          </Stack>
        </div>
      )}
    </Stack>
  );
}
