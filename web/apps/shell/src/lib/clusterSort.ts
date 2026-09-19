import type { ClusterInfo } from "./api";
import type { ClusterMeta } from "./cluster-meta-store";

/** Sort clusters: pinned first → lastUsed desc → alpha. */
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
    // Within same tier: recently used first
    const la = ma.lastUsed ?? 0;
    const lb = mb.lastUsed ?? 0;
    if (la !== lb) return lb - la;
    // Alpha fallback
    return a.id.localeCompare(b.id);
  });
}

/** Filter out hidden clusters and apply case-insensitive search against id and alias. */
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
    return c.id.toLowerCase().includes(q) || alias.includes(q);
  });
}
