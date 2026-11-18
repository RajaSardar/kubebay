import { QueryClient } from "@tanstack/react-query";

/**
 * The app's one QueryClient. There is deliberately no global `refetchInterval`:
 * a query that must poll sets its own (see docs/PERFORMANCE_AUDIT.md), so a
 * mounted CRD list, RBAC snapshot or settings read does not hit the engine
 * every 30 s for data that streams or events already keep fresh.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        // Show cached data immediately on context switch; background-refetch only when stale.
        // Without staleTime the default is 0: every focus/mount refetches even data fetched a
        // second ago, causing a loading flash when switching clusters.
        staleTime: 30_000,
        // Keep inactive query data in memory for 10 minutes so switching back to a previously-
        // viewed context restores the cache instantly without a network round-trip.
        gcTime: 10 * 60_000,
      },
    },
  });
}
