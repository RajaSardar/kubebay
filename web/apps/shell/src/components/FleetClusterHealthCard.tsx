import { useEffect, useMemo } from "react";
import { Badge, Card, Skeleton } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { useStaggeredEnable } from "../lib/useStaggeredEnable";
import { computeKindCounts } from "../lib/kindCounts";

export interface ClusterHealthSummary {
  unhealthy: number;
  total: number;
  synced: boolean;
}

/**
 * One cluster's workload/pod health rollup (backlog #15 Phase 1). Opens the
 * same six full-mode streams WorkloadsOverview.tsx does for its one active
 * cluster, but staggered via useStaggeredEnable so a fleet of several
 * clusters doesn't open every subscription in the same tick — and renders
 * its own skeleton independent of every other card, so one slow/remote
 * cluster's cold resync never blocks the rest of the page.
 */
export function FleetClusterHealthCard({
  cluster,
  index,
  concurrency = 3,
  intervalMs = 500,
  onOpen,
  onHealthComputed,
}: {
  cluster: string;
  index: number;
  concurrency?: number;
  intervalMs?: number;
  onOpen: (cluster: string) => void;
  onHealthComputed: (cluster: string, summary: ClusterHealthSummary) => void;
}) {
  const enabled = useStaggeredEnable(index, concurrency, intervalMs);
  const target = enabled ? cluster : undefined;

  const pods = useResourceStream(target, "v1/pods", { mode: "full", enabled });
  const nodes = useResourceStream(target, "v1/nodes", { mode: "full", enabled });
  const deployments = useResourceStream(target, "apps/v1/deployments", { mode: "full", enabled });
  const statefulsets = useResourceStream(target, "apps/v1/statefulsets", { mode: "full", enabled });
  const daemonsets = useResourceStream(target, "apps/v1/daemonsets", { mode: "full", enabled });
  const jobs = useResourceStream(target, "batch/v1/jobs", { mode: "full", enabled });

  const kinds = useMemo(
    () =>
      computeKindCounts({
        pods: pods.rows,
        nodes: nodes.rows,
        deployments: deployments.rows,
        statefulsets: statefulsets.rows,
        daemonsets: daemonsets.rows,
        jobs: jobs.rows,
      }),
    [pods.rows, nodes.rows, deployments.rows, statefulsets.rows, daemonsets.rows, jobs.rows],
  );

  const synced = enabled && pods.synced && nodes.synced && deployments.synced && statefulsets.synced && daemonsets.synced && jobs.synced;
  const totalUnhealthy = kinds.reduce((s, k) => s + k.unhealthy, 0);
  const totalCount = kinds.reduce((s, k) => s + k.total, 0);

  useEffect(() => {
    onHealthComputed(cluster, { unhealthy: totalUnhealthy, total: totalCount, synced });
    // onHealthComputed is expected to be referentially stable (a useCallback
    // in the parent); omitting it from deps avoids re-reporting on every
    // parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, totalUnhealthy, totalCount, synced]);

  return (
    <Card interactive>
      <div onClick={() => onOpen(cluster)} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <strong className="mono">{cluster}</strong>
          {synced && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {totalUnhealthy > 0 ? <Badge tone="err">{totalUnhealthy} issues</Badge> : <Badge tone="ok">healthy</Badge>}
            </span>
          )}
        </div>
        {!synced ? (
          <>
            <Skeleton w={160} h={10} />
            <div style={{ marginTop: 6 }}>
              <Skeleton w={100} h={10} />
            </div>
          </>
        ) : (
          <div className="muted small">
            {kinds.map((k) => `${k.label} ${k.healthy}/${k.total}`).join(" · ")}
          </div>
        )}
      </div>
    </Card>
  );
}
