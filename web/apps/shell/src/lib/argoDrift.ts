import type { ArgoCDResource } from "./api";

/**
 * The drift list backlog #12 settled on shipping without a line-level diff
 * (that needs argocd-server's own REST API + a token — a credential story
 * Kubebay deliberately doesn't have): status.resources[] already carries
 * per-object OutOfSync status straight off the k8s API. OutOfSync entries
 * sort first since they're the ones worth looking at.
 */
export function sortResourcesByDrift(resources: ArgoCDResource[]): ArgoCDResource[] {
  return [...resources].sort((a, b) => {
    const ad = a.status === "OutOfSync" ? 0 : 1;
    const bd = b.status === "OutOfSync" ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name);
  });
}

export function driftCount(resources: ArgoCDResource[]): number {
  return resources.filter((r) => r.status === "OutOfSync").length;
}
