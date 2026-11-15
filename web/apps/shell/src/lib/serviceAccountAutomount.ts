function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

export interface AutomountFinding {
  namespace: string;
  appLabel: string;
  podCount: number;
}

// Same grouping convention as lib/networkPolicyCoverage.ts's own pod
// grouping, kept consistent across this session's detector modules.
function podAppLabel(labels: Record<string, string>): string {
  return labels["app"] ?? labels["app.kubernetes.io/name"] ?? labels["k8s-app"] ?? "(unlabelled)";
}

/**
 * Backlog #28: flags a pod running under the "default" ServiceAccount with
 * its API token still automounted -- CIS Kubernetes Benchmark 5.1.5/5.1.6
 * ("default service accounts should not be actively used" /
 * "service account tokens should only be mounted where necessary"). The
 * default SA is rarely intended for API access, and an over-mounted token
 * on it is a well-established, real security smell (a compromised
 * container gets a live cluster credential it almost certainly never
 * needed) -- the same category of check Popeye/kube-bench already run.
 *
 * K8s resolution order, applied exactly as the API server itself resolves
 * it: a pod-level `automountServiceAccountToken` always wins; if unset,
 * the ServiceAccount object's own field decides; if that's unset too, the
 * cluster default is `true` (mounted).
 */
export function findDefaultServiceAccountAutomounts(
  pods: Record<string, unknown>[],
  serviceAccounts: Record<string, unknown>[],
): AutomountFinding[] {
  const saAutomountByNs = new Map<string, boolean | undefined>();
  for (const sa of serviceAccounts) {
    const meta = rec(sa.metadata);
    if (str(meta.name) !== "default") continue;
    const ns = str(meta.namespace);
    const val = sa.automountServiceAccountToken;
    saAutomountByNs.set(ns, typeof val === "boolean" ? val : undefined);
  }

  interface Group {
    namespace: string;
    appLabel: string;
    podCount: number;
  }
  const groups = new Map<string, Group>();

  for (const pod of pods) {
    const meta = rec(pod.metadata);
    const spec = rec(pod.spec);
    const namespace = str(meta.namespace, "default");
    const saName = str(spec.serviceAccountName) || str(spec.serviceAccount) || "default";
    if (saName !== "default") continue;

    const podLevel = spec.automountServiceAccountToken;
    let mounted: boolean;
    if (typeof podLevel === "boolean") {
      mounted = podLevel;
    } else {
      const saLevel = saAutomountByNs.get(namespace);
      mounted = saLevel === undefined ? true : saLevel;
    }
    if (!mounted) continue;

    const labels = rec(meta.labels) as Record<string, string>;
    const appLabel = podAppLabel(labels);
    const key = `${namespace}/${appLabel}`;
    const existing = groups.get(key);
    if (existing) {
      existing.podCount++;
    } else {
      groups.set(key, { namespace, appLabel, podCount: 1 });
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.namespace === b.namespace ? a.appLabel.localeCompare(b.appLabel) : a.namespace.localeCompare(b.namespace),
  );
}
