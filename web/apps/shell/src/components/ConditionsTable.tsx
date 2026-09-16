import { StatusDot } from "@kubebay/ui";

export interface Condition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/**
 * Renders a list of Kubernetes `status.conditions` entries as status-dot + type + reason rows.
 * Originally hand-built in NodeSummary.tsx for Node conditions; extracted here so any object
 * with a conditions array (Deployments, DaemonSets, StatefulSets, Jobs, PVCs, HPAs, CRDs, …)
 * can reuse the same look.
 *
 * Heuristic: for the "Ready" condition type, status "True" is healthy; for every other type
 * (MemoryPressure, DiskPressure, ReplicaFailure, …) status "False" is healthy. This mirrors
 * Node conditions exactly and is a reasonable default elsewhere, though it isn't universally
 * correct for every custom condition type (e.g. some CRDs use "True" as the positive signal
 * for non-Ready types) — it's a display heuristic, not a correctness guarantee.
 */
export function ConditionsTable({ conditions }: { conditions: Condition[] }) {
  return (
    <div className="pod-conditions">
      {conditions.map((c, i) => {
        const type = str(c.type);
        const st = str(c.status);
        const isReady = type === "Ready";
        const ok = isReady ? st === "True" : st === "False";
        const reason = str(c.reason);
        return (
          <div key={i} className="pod-condition">
            <StatusDot status={ok ? "connected" : st === "Unknown" ? "pending" : "unreachable"} />
            <span className="small">{type}</span>
            {reason && <span className="muted small">{reason}</span>}
          </div>
        );
      })}
    </div>
  );
}
