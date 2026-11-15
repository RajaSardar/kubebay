import type { CSSProperties } from "react";
import { Button, Row } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { rolloutHistory, type RolloutHistory } from "../lib/rolloutHistory";
import { fmtAge } from "../lib/resources";

function weekText(h: RolloutHistory): string {
  const n = h.rolloutsThisWeek;
  if (h.atLeast) return n > 0 ? `at least ${n} rollout${n === 1 ? "" : "s"} in the last 7 days` : "";
  return n === 0 ? "no rollouts in the last 7 days" : `${n} rollout${n === 1 ? "" : "s"} in the last 7 days`;
}

function lineText(h: RolloutHistory, now: number): string {
  const age = h.since ? fmtAge(now - Date.parse(h.since)) : "";
  if (h.first && age) return `Revision 1, no rollouts since it was created ${age} ago`;
  const head = !h.rollback
    ? `Revision ${h.revision}, rolled out ${age} ago`
    : age
      ? `Revision ${h.revision}, rolled back to an earlier template ${age} ago`
      : `Revision ${h.revision}, a rollback to an earlier template`;
  const week = weekText(h);
  return week ? `${head} · ${week}` : head;
}

/**
 * Overview v2, on a workload drawer's Summary: how old the current revision
 * is and how many rollouts the last 7 days had (lib/rolloutHistory), from the
 * history the cluster keeps (a Deployment's ReplicaSets, a StatefulSet's or
 * DaemonSet's ControllerRevisions), so it needs no recording. Leads to the
 * Rollout tab. Renders nothing until something owned carries a revision.
 */
export function RolloutLine({
  cluster,
  obj,
  onShowRollout,
  style,
}: {
  cluster: string;
  obj: Record<string, unknown>;
  onShowRollout?: () => void;
  style?: CSSProperties;
}) {
  const ns = String(((obj.metadata ?? {}) as Record<string, unknown>).namespace ?? "");
  const gvr = obj.kind === "StatefulSet" || obj.kind === "DaemonSet" ? "apps/v1/controllerrevisions" : "apps/v1/replicasets";
  const { rows } = useResourceStream(cluster || undefined, gvr, { mode: "full", ns: [ns] });
  const now = Date.now();
  const h = rolloutHistory(obj, rows, now);
  if (!h) return null;
  return (
    <Row gap={2} align="center" wrap style={style}>
      <span className="small">{lineText(h, now)}</span>
      {onShowRollout && (
        <Button variant="ghost" onClick={onShowRollout}>
          Rollout
        </Button>
      )}
    </Row>
  );
}
