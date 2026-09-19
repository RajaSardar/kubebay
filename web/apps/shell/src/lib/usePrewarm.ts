/**
 * Pre-warms backend informers for the most-visited GVRs as soon as a cluster
 * is active. Without this, informers only start when the user first navigates
 * to a page — requiring a full LIST round-trip from the API server on first
 * visit. With pre-warming, by the time the user clicks "Workloads" the backend
 * has already fetched and cached the data.
 *
 * Called at the AppInner level (not inside any page component) so it fires
 * unconditionally regardless of which route opens first — including deep-links.
 *
 * React's rules-of-hooks require a fixed number of hook calls per render, so
 * each GVR is listed explicitly. Add new GVRs here to cover more first visits.
 */
import { useResourceStream } from "./useResourceStream";

export function usePrewarm(cluster: string | undefined): void {
  // Core workloads — full mode because every workload page uses full objects.
  useResourceStream(cluster, "v1/pods", { mode: "full" });
  useResourceStream(cluster, "apps/v1/deployments", { mode: "full" });
  useResourceStream(cluster, "apps/v1/statefulsets", { mode: "full" });
  useResourceStream(cluster, "apps/v1/daemonsets", { mode: "full" });
  useResourceStream(cluster, "batch/v1/jobs", { mode: "full" });
  useResourceStream(cluster, "batch/v1/cronjobs", { mode: "full" });

  // Lightweight metadata — used by NamespaceFilter, Overview, Topology, RBAC.
  useResourceStream(cluster, "v1/namespaces", { mode: "metadata" });
  useResourceStream(cluster, "v1/nodes", { mode: "metadata" });
  useResourceStream(cluster, "v1/services", { mode: "metadata" });
  useResourceStream(cluster, "v1/events", { mode: "metadata" });
  useResourceStream(cluster, "v1/configmaps", { mode: "metadata" });
  useResourceStream(cluster, "networking.k8s.io/v1/ingresses", { mode: "metadata" });
}
