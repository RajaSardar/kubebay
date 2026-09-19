/**
 * Pre-warms backend informers for the most-visited GVRs as soon as a cluster
 * is active. Without this, informers only start when the user first navigates
 * to a page — requiring a full LIST round-trip from the API server on first
 * visit. With pre-warming, by the time the user clicks "Workloads" the backend
 * has already fetched and cached the data.
 *
 * Each useResourceStream call here is a no-op render component — it subscribes
 * to the stream and populates the module-level streamCache, but renders nothing.
 * React's rules-of-hooks require a fixed number of hook calls, so each GVR is
 * listed explicitly.
 */
import { useResourceStream } from "./useResourceStream";

export function usePrewarm(cluster: string | undefined): void {
  // Core workloads — full mode because every workload page uses full objects.
  useResourceStream(cluster, "v1/pods", { mode: "full" });
  useResourceStream(cluster, "apps/v1/deployments", { mode: "full" });
  useResourceStream(cluster, "apps/v1/statefulsets", { mode: "full" });
  useResourceStream(cluster, "apps/v1/daemonsets", { mode: "full" });
  useResourceStream(cluster, "batch/v1/jobs", { mode: "full" });

  // Lightweight metadata — used by NamespaceFilter, Overview, Topology.
  useResourceStream(cluster, "v1/namespaces", { mode: "metadata" });
  useResourceStream(cluster, "v1/nodes", { mode: "metadata" });
  useResourceStream(cluster, "v1/services", { mode: "metadata" });
}
