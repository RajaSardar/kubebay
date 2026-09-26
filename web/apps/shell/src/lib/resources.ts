export interface ResourceDef {
  slug: string;
  /** Plural display name for nav and headings, e.g. "Deployments". */
  label: string;
  /** The real Kubernetes Kind, e.g. "Deployment" — what events and ownerRefs use. */
  kind: string;
  gvr: string;
  group: string;
  resource: string;
  scoped: boolean;
  mode: "metadata" | "full";
}

function def(
  slug: string,
  label: string,
  kind: string,
  gvr: string,
  opts: Partial<ResourceDef> = {},
): ResourceDef {
  const parts = gvr.split("/");
  const resource = parts[parts.length - 1] ?? "";
  const group = parts.length === 3 ? parts[0] ?? "" : "";
  return {
    slug,
    label,
    kind,
    gvr,
    group,
    resource,
    scoped: false,
    mode: "metadata",
    ...opts,
  };
}

export const DEFS: Record<string, ResourceDef> = {
  deployments: def("deployments", "Deployments", "Deployment", "apps/v1/deployments", { mode: "full" }),
  replicasets: def("replicasets", "ReplicaSets", "ReplicaSet", "apps/v1/replicasets", { mode: "full" }),
  statefulsets: def("statefulsets", "StatefulSets", "StatefulSet", "apps/v1/statefulsets", { mode: "full" }),
  daemonsets: def("daemonsets", "DaemonSets", "DaemonSet", "apps/v1/daemonsets", { mode: "full" }),
  jobs: def("jobs", "Jobs", "Job", "batch/v1/jobs", { mode: "full" }),
  cronjobs: def("cronjobs", "CronJobs", "CronJob", "batch/v1/cronjobs", { mode: "full" }),
  configmaps: def("configmaps", "ConfigMaps", "ConfigMap", "v1/configmaps"),
  secrets: def("secrets", "Secrets", "Secret", "v1/secrets"),
  services: def("services", "Services", "Service", "v1/services"),
  ingresses: def("ingresses", "Ingresses", "Ingress", "networking.k8s.io/v1/ingresses"),
  persistentvolumeclaims: def("persistentvolumeclaims", "PVCs", "PersistentVolumeClaim", "v1/persistentvolumeclaims", { mode: "full" }),
  persistentvolumes: def("persistentvolumes", "PVs", "PersistentVolume", "v1/persistentvolumes", { scoped: true, mode: "full" }),
  storageclasses: def("storageclasses", "StorageClasses", "StorageClass", "storage.k8s.io/v1/storageclasses", { scoped: true, mode: "full" }),
  nodes: def("nodes", "Nodes", "Node", "v1/nodes", { scoped: true, mode: "full" }),
  networkpolicies: def("networkpolicies", "NetworkPolicies", "NetworkPolicy", "networking.k8s.io/v1/networkpolicies"),
  endpoints: def("endpoints", "Endpoints", "Endpoints", "v1/endpoints"),
  endpointslices: def("endpointslices", "EndpointSlices", "EndpointSlice", "discovery.k8s.io/v1/endpointslices"),
  horizontalpodautoscalers: def("horizontalpodautoscalers", "HPAs", "HorizontalPodAutoscaler", "autoscaling/v2/horizontalpodautoscalers", { mode: "full" }),
  verticalpodautoscalers: def("verticalpodautoscalers", "VerticalPodAutoscalers", "VerticalPodAutoscaler", "autoscaling.k8s.io/v1/verticalpodautoscalers", { mode: "full" }),
  poddisruptionbudgets: def("poddisruptionbudgets", "PDBs", "PodDisruptionBudget", "policy/v1/poddisruptionbudgets"),
  resourcequotas: def("resourcequotas", "ResourceQuotas", "ResourceQuota", "v1/resourcequotas"),
  limitranges: def("limitranges", "LimitRanges", "LimitRange", "v1/limitranges"),
  serviceaccounts: def("serviceaccounts", "ServiceAccounts", "ServiceAccount", "v1/serviceaccounts"),
  roles: def("roles", "Roles", "Role", "rbac.authorization.k8s.io/v1/roles"),
  clusterroles: def("clusterroles", "ClusterRoles", "ClusterRole", "rbac.authorization.k8s.io/v1/clusterroles", { scoped: true }),
  rolebindings: def("rolebindings", "RoleBindings", "RoleBinding", "rbac.authorization.k8s.io/v1/rolebindings"),
  clusterrolebindings: def("clusterrolebindings", "ClusterRoleBindings", "ClusterRoleBinding", "rbac.authorization.k8s.io/v1/clusterrolebindings", { scoped: true }),
  // Network
  ingressclasses: def("ingressclasses", "IngressClasses", "IngressClass", "networking.k8s.io/v1/ingressclasses", { scoped: true }),
  // Configuration
  priorityclasses: def("priorityclasses", "PriorityClasses", "PriorityClass", "scheduling.k8s.io/v1/priorityclasses", { scoped: true }),
  // Storage
  volumeattachments: def("volumeattachments", "VolumeAttachments", "VolumeAttachment", "storage.k8s.io/v1/volumeattachments", { scoped: true }),
  csidrivers: def("csidrivers", "CSI Drivers", "CSIDriver", "storage.k8s.io/v1/csidrivers", { scoped: true }),
  csinodes: def("csinodes", "CSI Nodes", "CSINode", "storage.k8s.io/v1/csinodes", { scoped: true }),
  // Cluster
  events: def("events", "Events", "Event", "v1/events", { mode: "full" }),
  runtimeclasses: def("runtimeclasses", "RuntimeClasses", "RuntimeClass", "node.k8s.io/v1/runtimeclasses", { scoped: true }),
  leases: def("leases", "Leases", "Lease", "coordination.k8s.io/v1/leases"),
  // Admission
  mutatingwebhookconfigurations: def("mutatingwebhookconfigurations", "Mutating Webhooks", "MutatingWebhookConfiguration", "admissionregistration.k8s.io/v1/mutatingwebhookconfigurations", { scoped: true }),
  validatingwebhookconfigurations: def("validatingwebhookconfigurations", "Validating Webhooks", "ValidatingWebhookConfiguration", "admissionregistration.k8s.io/v1/validatingwebhookconfigurations", { scoped: true }),
  validatingadmissionpolicies: def("validatingadmissionpolicies", "Admission Policies", "ValidatingAdmissionPolicy", "admissionregistration.k8s.io/v1/validatingadmissionpolicies", { scoped: true }),
  validatingadmissionpolicybindings: def("validatingadmissionpolicybindings", "Policy Bindings", "ValidatingAdmissionPolicyBinding", "admissionregistration.k8s.io/v1/validatingadmissionpolicybindings", { scoped: true }),
  // Workloads
  controllerrevisions: def("controllerrevisions", "ControllerRevisions", "ControllerRevision", "apps/v1/controllerrevisions"),
  replicationcontrollers: def("replicationcontrollers", "ReplicationControllers", "ReplicationController", "v1/replicationcontrollers", { mode: "full" }),
  // Storage
  csistoragecapacities: def("csistoragecapacities", "CSI Capacities", "CSIStorageCapacity", "storage.k8s.io/v1/csistoragecapacities"),
  // Cluster
  certificatesigningrequests: def("certificatesigningrequests", "CertSigningRequests", "CertificateSigningRequest", "certificates.k8s.io/v1/certificatesigningrequests", { scoped: true }),
  apiservices: def("apiservices", "API Services", "APIService", "apiregistration.k8s.io/v1/apiservices", { scoped: true }),
  flowschemas: def("flowschemas", "FlowSchemas", "FlowSchema", "flowcontrol.apiserver.k8s.io/v1/flowschemas", { scoped: true }),
  prioritylevelconfigurations: def("prioritylevelconfigurations", "Priority Levels", "PriorityLevelConfiguration", "flowcontrol.apiserver.k8s.io/v1/prioritylevelconfigurations", { scoped: true }),
};

export function extSlug(gvr: string): string {
  return gvr.replaceAll("/", "--");
}

/**
 * Best-effort Kind for a CRD we only know the plural of. A lowercase plural
 * cannot be reliably case-restored ("nodepools" is "NodePool", not "Nodepool"),
 * so this is only a placeholder until /api/crds supplies the declared Kind.
 */
function kindFromPlural(plural: string): string {
  const singular = plural.endsWith("ies")
    ? `${plural.slice(0, -3)}y`
    : plural.endsWith("ses") || plural.endsWith("xes")
      ? plural.slice(0, -2)
      : plural.endsWith("s")
        ? plural.slice(0, -1)
        : plural;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

/** Resolves a route slug to a ResourceDef, synthesizing one for `ext--` CRD routes. */
export function lookupDef(slug: string, sp: URLSearchParams): ResourceDef | undefined {
  if (DEFS[slug]) return DEFS[slug];
  if (EXTRA_DEFS[slug]) return EXTRA_DEFS[slug];
  if (!slug.startsWith("ext--")) return undefined;

  const parts = slug.slice(5).split("--");
  if (parts.length < 3) return undefined;
  const resource = parts[parts.length - 1] ?? "";
  const version = parts[parts.length - 2] ?? "";
  const group = parts.slice(0, -2).join(".");
  const gvr = group ? `${group}/${version}/${resource}` : `${version}/${resource}`;
  return {
    slug,
    label: resource,
    kind: kindFromPlural(resource),
    gvr,
    group,
    resource,
    scoped: sp.get("scoped") === "0",
    mode: "full",
  };
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
  namespaces: def("namespaces", "Namespaces", "Namespace", "v1/namespaces", { scoped: true, mode: "full" }),
};

export const KNOWN_GVRS = new Set(
  [...Object.values(DEFS), ...Object.values(EXTRA_DEFS)].map((d) => d.gvr),
);
