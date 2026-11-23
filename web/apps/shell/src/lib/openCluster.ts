import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import { connectCluster } from "./clusterConnections";
import { useClusterStore } from "./cluster-store";
import { useClusterMeta } from "./cluster-meta-store";
import { targetFor } from "./objectPath";

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

/**
 * Opens one object in its cluster, connected or not: opens the cluster as
 * openCluster does, then lands on the object's drawer (or a pod's list) instead
 * of the overview. Cross-cluster search results open through here.
 */
export function openObjectInCluster(
  o: { cluster: string; slug: string; ns: string; name: string },
  queryClient: QueryClient,
  navigate: NavigateFunction,
): void {
  connectCluster(o.cluster);
  useClusterStore.getState().setActive(o.cluster);
  useClusterMeta.getState().touchLastUsed(o.cluster);
  void queryClient.invalidateQueries({ queryKey: [o.cluster] });
  navigate(targetFor(o));
}
