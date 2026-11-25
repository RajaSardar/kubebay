/**
 * Pure helpers for cluster-picker redirect logic — exported for unit tests.
 *
 * Rule: only redirect to /clusters when there is no active cluster.
 * If the user already has a cluster selected (URL param or localStorage),
 * let them land directly on their last page rather than forcing a click-through.
 */
export function shouldRedirectToPicker(pathname: string, activeCluster: string): boolean {
  if (pathname === "/clusters") return false;
  return activeCluster.trim() === "";
}

/** Where a cluster-less visit goes: the settings are global, so /settings opens them over the Clusters page. */
export function pickerRedirectTarget(pathname: string, _activeCluster: string): string {
  return pathname === "/settings" ? "/clusters?settings=1" : "/clusters";
}

/**
 * The active cluster is only ever one the user chose: the URL's, else the
 * stored one. Never "the first reachable cluster": that fallback streamed a
 * cluster nobody picked and reconnected a cluster the moment it was
 * disconnected.
 */
export function resolveActiveCluster(urlCluster: string, storedCluster: string): string {
  return urlCluster || storedCluster;
}
