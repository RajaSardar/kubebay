/**
 * Sorts connected clusters worst-first for the Fleet dashboard (backlog
 * #15 Phase 1) — "which cluster needs attention right now" is the point of
 * a single-pane view, so the most unhealthy cluster leads. Ties (including
 * every cluster before its counts have streamed in) break by name so the
 * list doesn't jitter between re-renders with identical counts.
 */
export function sortClustersByHealth(entries: { cluster: string; unhealthy: number }[]): string[] {
  return [...entries]
    .sort((a, b) => b.unhealthy - a.unhealthy || a.cluster.localeCompare(b.cluster))
    .map((e) => e.cluster);
}
