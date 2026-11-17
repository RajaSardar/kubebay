import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { announceDisconnect } from "./clusterChannel";
import { dropClusterLocally } from "./useRemoteDisconnects";

/**
 * Disconnects a cluster: forgets it in this window, tells the other windows,
 * then asks the engine to drop it. Resolves to an error message if the engine
 * refused, or undefined on success.
 */
export function useDisconnectCluster(): (id: string) => Promise<string | undefined> {
  const queryClient = useQueryClient();
  return useCallback(
    async (id: string) => {
      let error: string | undefined;
      dropClusterLocally(id, queryClient);
      announceDisconnect(id);
      try {
        await api.disconnectCluster(id);
      } catch (e) {
        error = `Disconnect ${id}: ${e instanceof Error ? e.message : String(e)}`;
      }
      await queryClient.invalidateQueries({ queryKey: ["clusters"] });
      return error;
    },
    [queryClient],
  );
}
