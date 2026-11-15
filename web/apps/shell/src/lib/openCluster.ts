import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import { connectCluster } from "./clusterConnections";
import { useClusterStore } from "./cluster-store";
import { useClusterMeta } from "./cluster-meta-store";

/**
 * Opens a cluster: starts its background streams, makes it the active cluster,
 * notes that you used it, refreshes what was cached for it, and lands on its
 * overview. The Clusters page and the ⌘K palette both go through here, so they
 * can't drift apart.
 */
export function openCluster(id: string, queryClient: QueryClient, navigate: NavigateFunction): void {
  connectCluster(id);
  useClusterStore.getState().setActive(id);
  useClusterMeta.getState().touchLastUsed(id);
  void queryClient.invalidateQueries({ queryKey: [id] });
  navigate({ pathname: "/", search: `cluster=${encodeURIComponent(id)}` });
}
