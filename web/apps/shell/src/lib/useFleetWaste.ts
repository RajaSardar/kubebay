import { useQueries } from "@tanstack/react-query";
import { wasteApi, type WorkloadWaste } from "./api";
import { summarizeFleetWaste, type FleetWasteSummary } from "./fleetWaste";
import { summarizeShowback, type ShowbackRow } from "./fleetShowback";

/**
 * Backlog #15 Phase 2: N parallel React Query calls against the existing
 * /api/waste/workloads?cluster=X endpoint — polling, not streaming, so this
 * has none of Phase 1's informer cold-start concern. useQueries (not a
 * fixed-size list of useQuery calls) is what lets this take a variable-length
 * cluster list without breaking the rules of hooks.
 */
export function useFleetWaste(clusterIds: string[]): { summary: FleetWasteSummary; showback: ShowbackRow[]; loading: boolean } {
  const queries = useQueries({
    queries: clusterIds.map((id) => ({
      queryKey: ["waste-workloads", id],
      queryFn: () => wasteApi.workloads(id),
      refetchInterval: 30_000,
      retry: false,
    })),
  });

  const byCluster = clusterIds.map((cluster, i) => ({
    cluster,
    waste: (queries[i]?.data ?? []) as WorkloadWaste[],
  }));

  return {
    summary: summarizeFleetWaste(byCluster),
    showback: summarizeShowback(byCluster),
    loading: queries.some((q) => q.isLoading),
  };
}
