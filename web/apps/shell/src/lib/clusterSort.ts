import type { ClusterInfo } from "./api";
import type { ClusterMeta } from "./cluster-meta-store";

/** Sort clusters: pinned first, then by name. Never by last use, so rows stay put. */
export function sortClusters(
  list: ClusterInfo[],
  meta: Record<string, ClusterMeta>,
): ClusterInfo[] {
  return [...list].sort((a, b) => {
    const ma = meta[a.id] ?? {};
    const mb = meta[b.id] ?? {};
    // Pinned tier
    if (ma.pinned && !mb.pinned) return -1;
    if (!ma.pinned && mb.pinned) return 1;
    return a.id.localeCompare(b.id);
  });
}

/** Filter out hidden clusters and search id, alias, context and server, case-insensitively. */
export function filterClusters(
  list: ClusterInfo[],
  meta: Record<string, ClusterMeta>,
  query: string,
): ClusterInfo[] {
  const q = query.trim().toLowerCase();
  return list.filter((c) => {
    if (meta[c.id]?.hidden) return false;
    if (!q) return true;
    const alias = (meta[c.id]?.alias ?? "").toLowerCase();
    return [c.id, alias, c.context ?? "", c.server ?? ""].some((v) => v.toLowerCase().includes(q));
  });
}
