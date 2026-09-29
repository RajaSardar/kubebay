import { useResourceStream } from "../lib/useResourceStream";
import { buildRolloutProgress } from "../lib/rollout";
import { InlineBanner, Row, SkeletonLines } from "@kubebay/ui";

/**
 * Answers "is this rollout stuck, and on which ReplicaSet" — a stacked bar of
 * ready replicas per owned ReplicaSet (new vs old), plus the Progressing
 * condition when it indicates trouble. apps/v1/replicasets is already
 * streamed in full mode elsewhere in the app, so this is a new subscription
 * but no new backend work.
 */
export function RolloutProgress({
  cluster,
  namespace,
  obj,
}: {
  cluster: string;
  namespace: string;
  obj: Record<string, unknown> | null;
}) {
  const { rows, synced } = useResourceStream(cluster || undefined, "apps/v1/replicasets", {
    mode: "full",
    ns: namespace ? [namespace] : undefined,
  });

  if (!obj) {
    return <div className="muted small" style={{ padding: 14 }}>Could not load object data.</div>;
  }
  if (!synced && rows.length === 0) {
    return <SkeletonLines lines={4} label="Loading rollout status…" />;
  }

  const progress = buildRolloutProgress(obj, rows);
  const totalReady = progress.replicaSets.reduce((sum, rs) => sum + rs.ready, 0);
  const scale = Math.max(progress.desiredReplicas, totalReady, 1);

  return (
    <div className="pod-summary" style={{ padding: 14, overflowY: "auto", flex: 1 }}>
      {progress.stuck && (
        <InlineBanner flush role="alert" style={{ marginBottom: 12 }}>
          Rollout stuck (ProgressDeadlineExceeded){progress.progressingMessage ? `: ${progress.progressingMessage}` : "."}
        </InlineBanner>
      )}
      <div className="pod-section-title">
        Rollout progress ({totalReady}/{progress.desiredReplicas} ready)
      </div>
      <div className="rollout-bar">
        {progress.replicaSets
          .filter((rs) => rs.ready > 0)
          .map((rs) => (
            <div
              key={rs.name}
              className={`rollout-bar-segment${rs.isNew ? " new" : " old"}`}
              style={{ width: `${(rs.ready / scale) * 100}%` }}
              title={`${rs.name} (rev ${rs.revision}): ${rs.ready}/${rs.desired} ready`}
            />
          ))}
      </div>
      <div className="rollout-legend">
        {progress.replicaSets.length === 0 ? (
          <span className="muted small">No ReplicaSets found for this Deployment yet.</span>
        ) : (
          progress.replicaSets.map((rs) => (
            <Row align="center" gap={2} key={rs.name} className="small">
              <span className={`rollout-dot${rs.isNew ? " new" : " old"}`} />
              <span className="mono">{rs.name}</span>
              <span className="muted">rev {rs.revision || "–"}</span>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {rs.ready}/{rs.desired} ready
              </span>
            </Row>
          ))
        )}
      </div>
    </div>
  );
}
