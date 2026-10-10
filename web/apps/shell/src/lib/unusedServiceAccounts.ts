type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return (v ?? {}) as Obj;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The RBAC snapshot's binding shape (`/api/rbac/all`). */
export interface BindingLike {
  kind: string;
  name: string;
  ns?: string;
  roleRef: string;
  subjects: { kind: string; name: string; ns?: string }[];
}

export interface UnusedServiceAccount {
  namespace: string;
  name: string;
  createdAt: string;
  /** Bindings that name it directly, e.g. "RoleBinding shop/deployer → Role:edit". */
  bindings: string[];
  /** Legacy long-lived token Secrets for it: usable from outside the cluster. */
  tokenSecrets: string[];
}

/** The pod spec a Pod, a workload template or a CronJob's job template runs. */
function podSpecOf(o: Obj): Obj {
  const spec = rec(o.spec);
  if (spec.jobTemplate) return rec(rec(rec(rec(spec.jobTemplate).spec).template).spec);
  if (spec.template) return rec(rec(spec.template).spec);
  return spec;
}

/** The ServiceAccount a pod spec runs as; empty means "default", as the API server resolves it. */
function serviceAccountOf(spec: Obj): string {
  return str(spec.serviceAccountName) || str(spec.serviceAccount) || "default";
}

// Control-plane controllers act as ServiceAccounts here without running pods
// (kube-controller-manager's --use-service-account-credentials).
const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);

/**
 * Backlog #13's deferred RBAC check: ServiceAccounts no pod or workload
 * template in their namespace runs as. Skips each namespace's `default`
 * ServiceAccount (created automatically; #28 covers its use), the system
 * namespaces, and ServiceAccounts a controller owns. Ones that bindings grant
 * permissions to come first, since they hold access nothing visible uses.
 */
export function findUnusedServiceAccounts(input: {
  serviceAccounts: unknown[];
  pods: unknown[];
  workloads: unknown[];
  bindings: BindingLike[];
  secrets: unknown[];
}): UnusedServiceAccount[] {
  const used = new Set<string>();
  for (const o of [...input.pods, ...input.workloads]) {
    const ns = str(rec(rec(o).metadata).namespace);
    used.add(`${ns}/${serviceAccountOf(podSpecOf(rec(o)))}`);
  }

  const bindingsFor = new Map<string, string[]>();
  for (const b of input.bindings) {
    for (const s of b.subjects ?? []) {
      if (s.kind !== "ServiceAccount") continue;
      const key = `${s.ns ?? ""}/${s.name}`;
      const label = `${b.kind} ${b.ns ? `${b.ns}/` : ""}${b.name} → ${b.roleRef}`;
      const list = bindingsFor.get(key) ?? [];
      if (!list.includes(label)) list.push(label);
      bindingsFor.set(key, list);
    }
  }

  const tokensFor = new Map<string, string[]>();
  for (const s of input.secrets) {
    const meta = rec(rec(s).metadata);
    const saName = str(rec(meta.annotations)["kubernetes.io/service-account.name"]);
    if (!saName) continue;
    const key = `${str(meta.namespace)}/${saName}`;
    tokensFor.set(key, [...(tokensFor.get(key) ?? []), str(meta.name)]);
  }

  const out: UnusedServiceAccount[] = [];
  for (const o of input.serviceAccounts) {
    const meta = rec(rec(o).metadata);
    const namespace = str(meta.namespace);
    const name = str(meta.name);
    if (!name || name === "default" || SYSTEM_NAMESPACES.has(namespace) || arr(meta.ownerReferences).length > 0) continue;
    const key = `${namespace}/${name}`;
    if (used.has(key)) continue;
    out.push({
      namespace,
      name,
      createdAt: str(meta.creationTimestamp),
      bindings: [...(bindingsFor.get(key) ?? [])].sort(),
      tokenSecrets: [...(tokensFor.get(key) ?? [])].sort(),
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.bindings.length > 0) - Number(a.bindings.length > 0) ||
      a.namespace.localeCompare(b.namespace) ||
      a.name.localeCompare(b.name),
  );
}
