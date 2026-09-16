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
  cronjobs: def("cronjobs", "CronJobs", "batch/v1/cronjobs", { mode: "full" }),
  configmaps: def("configmaps", "ConfigMaps", "v1/configmaps"),
  secrets: def("secrets", "Secrets", "v1/secrets"),
  services: def("services", "Services", "v1/services"),
  ingresses: def("ingresses", "Ingresses", "networking.k8s.io/v1/ingresses"),
  persistentvolumeclaims: def("persistentvolumeclaims", "PVCs", "v1/persistentvolumeclaims", { mode: "full" }),
  persistentvolumes: def("persistentvolumes", "PVs", "v1/persistentvolumes", { scoped: true, mode: "full" }),
  storageclasses: def("storageclasses", "StorageClasses", "storage.k8s.io/v1/storageclasses", { scoped: true, mode: "full" }),
  nodes: def("nodes", "Nodes", "v1/nodes", { scoped: true, mode: "full" }),
  networkpolicies: def("networkpolicies", "NetworkPolicies", "networking.k8s.io/v1/networkpolicies"),
  endpoints: def("endpoints", "Endpoints", "v1/endpoints"),
  endpointslices: def("endpointslices", "EndpointSlices", "discovery.k8s.io/v1/endpointslices"),
  horizontalpodautoscalers: def("horizontalpodautoscalers", "HPAs", "autoscaling/v2/horizontalpodautoscalers", { mode: "full" }),
  verticalpodautoscalers: def("verticalpodautoscalers", "VerticalPodAutoscalers", "autoscaling.k8s.io/v1/verticalpodautoscalers", { mode: "full" }),
  poddisruptionbudgets: def("poddisruptionbudgets", "PDBs", "policy/v1/poddisruptionbudgets"),
  resourcequotas: def("resourcequotas", "ResourceQuotas", "v1/resourcequotas"),
  limitranges: def("limitranges", "LimitRanges", "v1/limitranges"),
  serviceaccounts: def("serviceaccounts", "ServiceAccounts", "v1/serviceaccounts"),
  roles: def("roles", "Roles", "rbac.authorization.k8s.io/v1/roles"),
  clusterroles: def("clusterroles", "ClusterRoles", "rbac.authorization.k8s.io/v1/clusterroles", { scoped: true }),
  rolebindings: def("rolebindings", "RoleBindings", "rbac.authorization.k8s.io/v1/rolebindings"),
  clusterrolebindings: def("clusterrolebindings", "ClusterRoleBindings", "rbac.authorization.k8s.io/v1/clusterrolebindings", { scoped: true }),
  // Network
  ingressclasses: def("ingressclasses", "IngressClasses", "networking.k8s.io/v1/ingressclasses", { scoped: true }),
  // Configuration
  priorityclasses: def("priorityclasses", "PriorityClasses", "scheduling.k8s.io/v1/priorityclasses", { scoped: true }),
  // Storage
  volumeattachments: def("volumeattachments", "VolumeAttachments", "storage.k8s.io/v1/volumeattachments", { scoped: true }),
  csidrivers: def("csidrivers", "CSI Drivers", "storage.k8s.io/v1/csidrivers", { scoped: true }),
  csinodes: def("csinodes", "CSI Nodes", "storage.k8s.io/v1/csinodes", { scoped: true }),
  // Cluster
  events: def("events", "Events", "v1/events", { mode: "full" }),
  runtimeclasses: def("runtimeclasses", "RuntimeClasses", "node.k8s.io/v1/runtimeclasses", { scoped: true }),
  leases: def("leases", "Leases", "coordination.k8s.io/v1/leases"),
  // Admission
  mutatingwebhookconfigurations: def("mutatingwebhookconfigurations", "Mutating Webhooks", "admissionregistration.k8s.io/v1/mutatingwebhookconfigurations", { scoped: true }),
  validatingwebhookconfigurations: def("validatingwebhookconfigurations", "Validating Webhooks", "admissionregistration.k8s.io/v1/validatingwebhookconfigurations", { scoped: true }),
  validatingadmissionpolicies: def("validatingadmissionpolicies", "Admission Policies", "admissionregistration.k8s.io/v1/validatingadmissionpolicies", { scoped: true }),
  validatingadmissionpolicybindings: def("validatingadmissionpolicybindings", "Policy Bindings", "admissionregistration.k8s.io/v1/validatingadmissionpolicybindings", { scoped: true }),
  // Workloads
  controllerrevisions: def("controllerrevisions", "ControllerRevisions", "apps/v1/controllerrevisions"),
  replicationcontrollers: def("replicationcontrollers", "ReplicationControllers", "v1/replicationcontrollers", { mode: "full" }),
  // Storage
  csistoragecapacities: def("csistoragecapacities", "CSI Capacities", "storage.k8s.io/v1/csistoragecapacities"),
  // Cluster
  certificatesigningrequests: def("certificatesigningrequests", "CertSigningRequests", "certificates.k8s.io/v1/certificatesigningrequests", { scoped: true }),
  apiservices: def("apiservices", "API Services", "apiregistration.k8s.io/v1/apiservices", { scoped: true }),
  flowschemas: def("flowschemas", "FlowSchemas", "flowcontrol.apiserver.k8s.io/v1/flowschemas", { scoped: true }),
  prioritylevelconfigurations: def("prioritylevelconfigurations", "Priority Levels", "flowcontrol.apiserver.k8s.io/v1/prioritylevelconfigurations", { scoped: true }),
};

export function extSlug(gvr: string): string {
  return gvr.replaceAll("/", "--");
}

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
  namespaces: def("namespaces", "Namespaces", "v1/namespaces", { scoped: true, mode: "full" }),
};

export const KNOWN_GVRS = new Set(
  [...Object.values(DEFS), ...Object.values(EXTRA_DEFS)].map((d) => d.gvr),
);
