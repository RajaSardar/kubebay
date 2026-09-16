/**
 * Module-level cache for WebSocket resource streams.
 * Survives React component unmount/remount so re-navigating to a tab
 * immediately shows the last-known rows with no skeleton flash.
 * TTL-expired entries are served as "pre-warmed skeleton" (synced=true,
 * rows=[]) so the table renders instantly and fills in from the WS.
 */

interface CacheEntry {
  /** Map entries [key, obj] — preserving server-assigned keys for delta correctness */
  entries: [string, Record<string, unknown>][];
  synced: boolean;
  savedAt: number;
}

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

const cache = new Map<string, CacheEntry>();

export function getStreamCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function setStreamCache(
  key: string,
  entries: [string, Record<string, unknown>][],
  synced: boolean,
): void {
  cache.set(key, { entries, synced, savedAt: Date.now() });
}

/** Call when switching clusters so stale data from old cluster is not shown. */
export function clearStreamCacheForCluster(cluster: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${cluster}|`)) cache.delete(key);
  }
}

/** Wipe everything — e.g. on app restart / engine reconnect. */
export function clearAllStreamCache(): void {
  cache.clear();
}
