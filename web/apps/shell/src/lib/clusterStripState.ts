/** How a cluster in the strip is doing: looked at, streaming, put to sleep, or never connected. */
export function stripItemState(s: { active?: boolean; streaming?: boolean; sleeping?: boolean }): "active" | "streaming" | "sleeping" | "" {
  if (s.active) return "active";
  if (s.sleeping) return "sleeping";
  if (s.streaming) return "streaming";
  return "";
}

/**
 * The clusters the engine must never put to sleep to make room: the one the
 * user is looking at and their pinned ones. Both live in the browser, so the
 * browser tells the engine.
 */
export function protectedClusterIds(active: string, meta: Record<string, { pinned?: boolean }>): string[] {
  const ids = new Set<string>();
  if (active) ids.add(active);
  for (const [id, m] of Object.entries(meta)) if (m.pinned) ids.add(id);
  return [...ids];
}
