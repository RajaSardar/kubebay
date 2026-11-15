/**
 * Module-level cache for WebSocket resource streams.
 * Survives React component unmount/remount so re-navigating to a tab
 * immediately shows the last-known rows with no skeleton flash.
 *
 * No TTL — entries live until explicitly cleared (cluster switch or disconnect)
 * or pushed out by the row budget below.
 * The live WS delta stream self-heals any staleness, so a time-based eviction
 * only adds the flash bug without providing real freshness guarantees.
 */

interface CacheEntry {
  /** Map entries [key, obj] — preserving server-assigned keys for delta correctness */
  entries: [string, Record<string, unknown>][];
  synced: boolean;
}

/**
 * Most rows held across all cached streams. Past it the least recently used
 * stream is dropped (never the one just written), so a long session over big
 * clusters can't grow the webview without bound.
 */
export const MAX_CACHED_ROWS = 50_000;

// Map iterates in insertion order: the first key is the least recently used.
const cache = new Map<string, CacheEntry>();
let totalRows = 0;

export function getStreamCache(key: string): CacheEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function setStreamCache(
  key: string,
  entries: [string, Record<string, unknown>][],
  synced: boolean,
): void {
  const old = cache.get(key);
  if (old) totalRows -= old.entries.length;
  cache.delete(key);
  cache.set(key, { entries, synced });
  totalRows += entries.length;
  for (const k of cache.keys()) {
    if (totalRows <= MAX_CACHED_ROWS || k === key) break;
    totalRows -= cache.get(k)!.entries.length;
    cache.delete(k);
  }
}

/** Call when switching clusters so stale data from old cluster is not shown. */
export function clearStreamCacheForCluster(cluster: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${cluster}|`)) {
      totalRows -= cache.get(key)!.entries.length;
      cache.delete(key);
    }
  }
}

/** Wipe everything — e.g. on engine reconnect. */
export function clearAllStreamCache(): void {
  cache.clear();
  totalRows = 0;
}

/** How many entries are currently cached — useful for debugging. */
export function streamCacheSize(): number {
  return cache.size;
}
