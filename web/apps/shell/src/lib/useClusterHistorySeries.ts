import { useQuery } from "@tanstack/react-query";
import { historyApi } from "./api";

const HISTORY_DAYS = 35;

/**
 * The cluster-total hourly usage series for the whole retention window.
 * Shared by the headroom forecast and the anomaly card so both read one fetch.
 */
export function useClusterHistorySeries(cluster: string) {
  return useQuery({
    queryKey: ["history-series", cluster],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - HISTORY_DAYS * 86_400_000);
      return historyApi.series(cluster, from.toISOString(), to.toISOString());
    },
    enabled: !!cluster,
    refetchInterval: 15 * 60_000,
    retry: false,
  });
}
