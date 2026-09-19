/**
 * Module-level cache for WebSocket resource streams.
 * Survives React component unmount/remount so re-navigating to a tab
 * immediately shows the last-known rows with no skeleton flash.
 *
 * No TTL — entries live until explicitly cleared (cluster switch or disconnect).
 * The live WS delta stream self-heals any staleness, so a time-based eviction
 * only adds the flash bug without providing real freshness guarantees.
 */

interface CacheEntry {
  /** Map entries [key, obj] — preserving server-assigned keys for delta correctness */
  entries: [string, Record<string, unknown>][];
  synced: boolean;
}

const cache = new Map<string, CacheEntry>();

export function getStreamCache(key: string): CacheEntry | null {
  return cache.get(key) ?? null;
}

export function setStreamCache(
  key: string,
  entries: [string, Record<string, unknown>][],
  synced: boolean,
): void {
  cache.set(key, { entries, synced });
}

/** Call when switching clusters so stale data from old cluster is not shown. */
export function clearStreamCacheForCluster(cluster: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${cluster}|`)) cache.delete(key);
  }
}

/** Wipe everything — e.g. on engine reconnect. */
export function clearAllStreamCache(): void {
  cache.clear();
}

/** How many entries are currently cached — useful for debugging. */
export function streamCacheSize(): number {
  return cache.size;
}
