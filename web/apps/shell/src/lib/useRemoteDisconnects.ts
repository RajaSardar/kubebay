import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { onRemoteDisconnect } from "./clusterChannel";
import { disconnectCluster } from "./clusterConnections";
import { useClusterStore } from "./cluster-store";

/** Forget a cluster in this window: its streams, its cached data, and the active choice if it was this one. */
export function dropClusterLocally(id: string, queryClient: QueryClient): void {
  disconnectCluster(id);
  if (useClusterStore.getState().active === id) useClusterStore.getState().setActive("");
  queryClient.removeQueries({ predicate: (q) => q.queryKey.includes(id) });
  void queryClient.invalidateQueries({ queryKey: ["clusters"] });
}

/**
 * Applies disconnects made in other windows. Without it, this window's open
 * subscriptions would reconnect the cluster right after the engine dropped it.
 */
export function useRemoteDisconnects(): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useEffect(
    () =>
      onRemoteDisconnect((id) => {
        const wasActive = useClusterStore.getState().active === id;
        dropClusterLocally(id, queryClient);
        if (wasActive && window.location.pathname !== "/clusters") navigate("/clusters", { replace: true });
      }),
    [queryClient, navigate],
  );
}
