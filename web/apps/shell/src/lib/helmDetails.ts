import type { HelmRelease, ReleaseResource } from "./api";
import { extSlug, slugForKind } from "./resources";

// ADR 0004 S8: what a release's Overview needs from its details.

/** The page of an object a release created; none for a kind the cluster no longer serves. */
export function resourceHref(r: ReleaseResource): string | undefined {
  if (!r.served) return undefined;
  let slug = slugForKind(r.kind);
  if (!slug && r.resource) {
    const [group, version] = r.apiVersion.includes("/") ? r.apiVersion.split("/") : ["", r.apiVersion];
    slug = `ext--${extSlug(group ? `${group}/${version}/${r.resource}` : `${version}/${r.resource}`)}`;
  }
  return slug ? `/detail/${slug}/${r.namespace || "_"}/${r.name}` : undefined;
}

const GROUPS: [string, string[]][] = [
  ["Workloads", ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"]],
  ["Networking", ["Service", "Ingress", "IngressClass", "NetworkPolicy", "Gateway", "HTTPRoute", "EndpointSlice"]],
  ["Config", ["ConfigMap", "Secret"]],
  ["Storage", ["PersistentVolumeClaim", "PersistentVolume", "StorageClass"]],
  ["Scaling", ["HorizontalPodAutoscaler", "PodDisruptionBudget"]],
  ["Access", ["ServiceAccount", "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"]],
];

/** The release's objects grouped by what they're for, in a fixed order; a kind outside these is Other. */
export function groupResources(resources: readonly ReleaseResource[]): { group: string; rows: ReleaseResource[] }[] {
  const rank = new Map<string, [number, number]>();
  GROUPS.forEach(([, kinds], g) => kinds.forEach((k, i) => rank.set(k, [g, i])));
  const out = new Map<string, ReleaseResource[]>();
  const order = (r: ReleaseResource) => rank.get(r.kind) ?? [GROUPS.length, 0];
  const sorted = [...resources].sort((a, b) => {
    const [ga, ia] = order(a);
    const [gb, ib] = order(b);
    return ga - gb || ia - ib || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
  });
  for (const r of sorted) {
    const g = rank.has(r.kind) ? GROUPS[rank.get(r.kind)![0]]![0] : "Other";
    out.set(g, [...(out.get(g) ?? []), r]);
  }
  return [...out].map(([group, rows]) => ({ group, rows }));
}

/** Helm's timeout for an install, upgrade, rollback or uninstall (the engine's helmTimeout). */
const HELM_TIMEOUT_MIN = 5;

/** Minutes a pending release has been pending, once that's past Helm's timeout; null otherwise. */
export function stuckFor(release: Pick<HelmRelease, "status" | "updated">, now = Date.now()): number | null {
  if (!release.status.startsWith("pending") || !release.updated) return null;
  const at = Date.parse(release.updated);
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor((now - at) / 60_000);
  return minutes > HELM_TIMEOUT_MIN ? minutes : null;
}
