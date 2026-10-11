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
  const head = h.rollback ? `Revision ${h.revision}, a rollback to an earlier template` : `Revision ${h.revision}, rolled out ${age} ago`;
  const week = weekText(h);
  return week ? `${head} · ${week}` : head;
}

/**
 * Overview v2, on a Deployment drawer's Summary: how old the current revision
 * is and how many rollouts the last 7 days had (lib/rolloutHistory), from the
 * ReplicaSets the cluster keeps, so it needs no recording. Leads to the
 * Rollout tab. Renders nothing until an owned ReplicaSet carries a revision.
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
  const { rows } = useResourceStream(cluster || undefined, "apps/v1/replicasets", { mode: "full", ns: [ns] });
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
