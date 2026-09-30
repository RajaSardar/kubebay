function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface SecretExposureFinding {
  namespace: string;
  appLabel: string;
  podCount: number;
  secretNames: string[];
}

// Same grouping convention as lib/networkPolicyCoverage.ts and
// lib/serviceAccountAutomount.ts.
function podAppLabel(labels: Record<string, string>): string {
  return labels["app"] ?? labels["app.kubernetes.io/name"] ?? labels["k8s-app"] ?? "(unlabelled)";
}

function secretNamesFromContainer(container: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const e of arr(container.env)) {
    const secretKeyRef = rec(rec(e).valueFrom).secretKeyRef;
    if (secretKeyRef) {
      const name = str(rec(secretKeyRef).name);
      if (name) names.add(name);
    }
  }
  for (const ef of arr(container.envFrom)) {
    const secretRef = rec(ef).secretRef;
    if (secretRef) {
      const name = str(rec(secretRef).name);
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

/**
 * Backlog #29: flags a pod group that exposes one or more Secrets via
 * environment variables (`env[].valueFrom.secretKeyRef` or
 * `envFrom[].secretRef`) rather than a mounted volume -- a well-established
 * Kubernetes hardening guideline (CIS Benchmark discussion, NSA/CISA
 * hardening guide): env-var secrets are more exposed than a mounted file --
 * they leak into `kubectl exec ... env`, child-process environments,
 * `/proc/<pid>/environ`, and are far more likely to end up in crash dumps
 * or accidental logging than a value an app has to explicitly read from a
 * file. Never reads actual Secret values -- only which Secrets a pod's
 * spec references and how, so no sensitive data is ever touched.
 */
export function findSecretEnvExposures(pods: Record<string, unknown>[]): SecretExposureFinding[] {
  interface Group {
    namespace: string;
    appLabel: string;
    podCount: number;
    secretNames: Set<string>;
  }
  const groups = new Map<string, Group>();

  for (const pod of pods) {
    const meta = rec(pod.metadata);
    const spec = rec(pod.spec);
    const namespace = str(meta.namespace, "default");
    const labels = rec(meta.labels) as Record<string, string>;
    const appLabel = podAppLabel(labels);

    const secretNames = new Set<string>();
    for (const c of [...arr(spec.containers), ...arr(spec.initContainers)]) {
      for (const name of secretNamesFromContainer(rec(c))) secretNames.add(name);
    }
    if (secretNames.size === 0) continue;

    const key = `${namespace}/${appLabel}`;
    const existing = groups.get(key);
    if (existing) {
      existing.podCount++;
      for (const name of secretNames) existing.secretNames.add(name);
    } else {
      groups.set(key, { namespace, appLabel, podCount: 1, secretNames });
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => (a.namespace === b.namespace ? a.appLabel.localeCompare(b.appLabel) : a.namespace.localeCompare(b.namespace)))
    .map((g) => ({ namespace: g.namespace, appLabel: g.appLabel, podCount: g.podCount, secretNames: Array.from(g.secretNames).sort() }));
}
