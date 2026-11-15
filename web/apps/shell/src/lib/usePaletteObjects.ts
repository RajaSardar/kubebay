import { useEffect, useMemo, useState } from "react";
import { getClusterRows, subscribeConnections } from "./clusterConnections";
import type { SearchObject } from "./paletteSearch";

// The streams the app already follows for every connected cluster
// (clusterConnections.ts, CORE_GVRS). The palette reads them and opens none.
const FOLLOWED: { slug: string; gvr: string; mode: "metadata" | "full" }[] = [
  { slug: "pods", gvr: "v1/pods", mode: "full" },
  { slug: "deployments", gvr: "apps/v1/deployments", mode: "full" },
  { slug: "statefulsets", gvr: "apps/v1/statefulsets", mode: "full" },
  { slug: "daemonsets", gvr: "apps/v1/daemonsets", mode: "full" },
  { slug: "jobs", gvr: "batch/v1/jobs", mode: "full" },
  { slug: "nodes", gvr: "v1/nodes", mode: "metadata" },
  { slug: "namespaces", gvr: "v1/namespaces", mode: "metadata" },
];

function collect(clusters: string[]): SearchObject[] {
  const out: SearchObject[] = [];
  for (const cluster of clusters) {
    for (const k of FOLLOWED) {
      for (const row of getClusterRows(cluster, k.gvr, k.mode)) {
        const meta = (row.metadata ?? {}) as { name?: string; namespace?: string };
        if (!meta.name) continue;
        out.push({ cluster, slug: k.slug, ns: meta.namespace ?? "", name: meta.name, row });
      }
    }
  }
  return out;
}

/**
 * Every followed object of the given clusters, while `open` is true. Closed, it
 * reads nothing, listens to nothing and returns an empty list, so the palette
 * costs nothing on every other page. Open, it re-reads when the connection
 * manager reports new data (at most once a second).
 */
export function usePaletteObjects(open: boolean, clusters: string[]): SearchObject[] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    return subscribeConnections(() => setTick((t) => t + 1));
  }, [open]);
  const key = clusters.join("\u0000");
  return useMemo(() => (open ? collect(clusters) : []), [open, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}
