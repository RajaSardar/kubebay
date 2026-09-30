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

export interface OrphanedSecret {
  namespace: string;
  name: string;
  createdAt: string;
}

/** The pod spec a Pod, a workload template or a CronJob's job template runs. */
function podSpecOf(o: Obj): Obj {
  const spec = rec(o.spec);
  if (spec.jobTemplate) return rec(rec(rec(rec(spec.jobTemplate).spec).template).spec);
  if (spec.template) return rec(rec(spec.template).spec);
  return spec;
}

function podSpecRefs(spec: Obj): string[] {
  const refs: string[] = [];
  for (const v of arr(spec.volumes)) {
    refs.push(str(rec(rec(v).secret).secretName));
    for (const src of arr(rec(rec(v).projected).sources)) refs.push(str(rec(rec(src).secret).name));
  }
  for (const c of [...arr(spec.containers), ...arr(spec.initContainers), ...arr(spec.ephemeralContainers)]) {
    for (const e of arr(rec(c).env)) refs.push(str(rec(rec(rec(e).valueFrom).secretKeyRef).name));
    for (const e of arr(rec(c).envFrom)) refs.push(str(rec(rec(e).secretRef).name));
  }
  for (const p of arr(spec.imagePullSecrets)) refs.push(str(rec(p).name));
  return refs;
}

/**
 * Secrets that live outside pod-spec references by design: Helm release
 * records, legacy ServiceAccount tokens, anything a controller owns or
 * cert-manager manages, and kube-system (control-plane components read
 * their Secrets directly).
 */
function isManaged(meta: Obj): boolean {
  const labels = rec(meta.labels);
  const annotations = rec(meta.annotations);
  return (
    str(meta.namespace) === "kube-system" ||
    labels.owner === "helm" ||
    "kubernetes.io/service-account.name" in annotations ||
    "cert-manager.io/certificate-name" in annotations ||
    arr(meta.ownerReferences).length > 0
  );
}

/**
 * Roadmap Tier 2 #16: Secrets nothing in the cluster references. Needs only
 * Secret metadata, so Secret values never reach the shell. A Secret counts as
 * used when a pod, a workload template (a Deployment at zero replicas or a
 * CronJob between runs still uses it), a ServiceAccount or an Ingress's TLS
 * block in its own namespace names it. References from custom resources
 * (Gateway certificateRefs, operator CRs) aren't visible here, so this is a
 * list to review, not to delete from.
 */
export function findOrphanedSecrets(input: {
  secrets: Obj[];
  pods: Obj[];
  workloads: Obj[];
  serviceAccounts: Obj[];
  ingresses: Obj[];
}): OrphanedSecret[] {
  const used = new Set<string>();
  const mark = (ns: string, names: string[]) => {
    for (const n of names) if (n) used.add(`${ns}/${n}`);
  };

  for (const o of [...input.pods, ...input.workloads]) mark(str(rec(o.metadata).namespace), podSpecRefs(podSpecOf(o)));
  for (const sa of input.serviceAccounts) {
    mark(str(rec(sa.metadata).namespace), [...arr(sa.secrets), ...arr(sa.imagePullSecrets)].map((r) => str(rec(r).name)));
  }
  for (const ing of input.ingresses) {
    mark(str(rec(ing.metadata).namespace), arr(rec(ing.spec).tls).map((t) => str(rec(t).secretName)));
  }

  const out: OrphanedSecret[] = [];
  for (const s of input.secrets) {
    const meta = rec(s.metadata);
    const namespace = str(meta.namespace);
    const name = str(meta.name);
    if (!name || isManaged(meta) || used.has(`${namespace}/${name}`)) continue;
    out.push({ namespace, name, createdAt: str(meta.creationTimestamp) });
  }
  return out.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}
