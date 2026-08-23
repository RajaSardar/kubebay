export interface ResourceDef {
  slug: string;
  label: string;
  gvr: string;
  group: string;
  resource: string;
  scoped: boolean;
  mode: "metadata" | "full";
}

function def(
  slug: string,
  label: string,
  gvr: string,
  opts: Partial<ResourceDef> = {},
): ResourceDef {
  const parts = gvr.split("/");
  const resource = parts[parts.length - 1] ?? "";
  const group = parts.length === 3 ? parts[0] ?? "" : "";
  return {
    slug,
    label,
    gvr,
    group,
    resource,
    scoped: false,
    mode: "metadata",
    ...opts,
  };
}

export const DEFS: Record<string, ResourceDef> = {
  deployments: def("deployments", "Deployments", "apps/v1/deployments", { mode: "full" }),
  replicasets: def("replicasets", "ReplicaSets", "apps/v1/replicasets", { mode: "full" }),
  statefulsets: def("statefulsets", "StatefulSets", "apps/v1/statefulsets", { mode: "full" }),
  daemonsets: def("daemonsets", "DaemonSets", "apps/v1/daemonsets", { mode: "full" }),
  jobs: def("jobs", "Jobs", "batch/v1/jobs", { mode: "full" }),
  cronjobs: def("cronjobs", "CronJobs", "batch/v1/cronjobs", { mode: "metadata" }),
  configmaps: def("configmaps", "ConfigMaps", "v1/configmaps"),
  secrets: def("secrets", "Secrets", "v1/secrets"),
  services: def("services", "Services", "v1/services"),
  ingresses: def("ingresses", "Ingresses", "networking.k8s.io/v1/ingresses"),
  persistentvolumeclaims: def("persistentvolumeclaims", "PVCs", "v1/persistentvolumeclaims", { mode: "full" }),
  persistentvolumes: def("persistentvolumes", "PVs", "v1/persistentvolumes", { scoped: true, mode: "full" }),
  storageclasses: def("storageclasses", "StorageClasses", "storage.k8s.io/v1/storageclasses", { scoped: true }),
  nodes: def("nodes", "Nodes", "v1/nodes", { scoped: true, mode: "full" }),
};

export function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ageOf(obj: Record<string, unknown>): number {
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;
  const created = meta.creationTimestamp ? Date.parse(meta.creationTimestamp as string) : Date.now();
  return Math.max(0, Date.now() - created);
}

export function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export const EXTRA_DEFS: Record<string, ResourceDef> = {
  namespaces: def("namespaces", "Namespaces", "v1/namespaces", { scoped: true }),
};
