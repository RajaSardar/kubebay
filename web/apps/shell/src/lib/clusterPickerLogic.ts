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
